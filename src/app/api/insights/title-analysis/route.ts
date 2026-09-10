import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { rateLimitAll } from "@/lib/rate-limit";
import { runTitleAnalysis, TitleRunError } from "@/lib/insights/titleRun";
import { toDateString, weekStartOf, addDays } from "@/lib/insights/weeks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const site = typeof body.site === "string" ? body.site : "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const limited = await rateLimitAll([
    { key: `ratelimit:insights:titles:${session.email}`, limit: 10, windowSeconds: 3600 },
    { key: `ratelimit:insights:titles:site:${site}`, limit: 40, windowSeconds: 3600 },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Překročen limit rozborů. Zkuste to později.", retryAfter: limited.retryAfter },
      { status: 429 }
    );
  }

  const now = new Date();
  const defaultTo = toDateString(addDays(weekStartOf(now), -7));
  const defaultFrom = toDateString(addDays(weekStartOf(now), -7 * 13));

  try {
    const out = await runTitleAnalysis({
      siteId: site,
      weekStartFrom:
        typeof body.from === "string" && body.from ? body.from : defaultFrom,
      weekStartTo: typeof body.to === "string" && body.to ? body.to : defaultTo,
      perCohort:
        typeof body.perCohort === "number" && Number.isFinite(body.perCohort)
          ? Math.min(Math.max(15, Math.round(body.perCohort)), 100)
          : 60,
      promptKey: typeof body.promptKey === "string" ? body.promptKey : null,
      modelKey: typeof body.modelKey === "string" ? body.modelKey : null,
      email: session.email,
    });
    return NextResponse.json(out);
  } catch (error) {
    if (error instanceof TitleRunError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("title analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rozbor selhal." },
      { status: 502 }
    );
  }
}
