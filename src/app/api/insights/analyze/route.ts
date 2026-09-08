import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { rateLimitAll } from "@/lib/rate-limit";
import {
  InsightsAnalysisError,
  runInsightsAnalysis,
} from "@/lib/insights/analyze";
import type { AnalysisScope } from "@/lib/insights/types";
import { toDateString, weekStartOf, addDays } from "@/lib/insights/weeks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_USER_RUNS_PER_HOUR = 10;
const GLOBAL_RUNS_PER_HOUR = 40;

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
    {
      key: `ratelimit:insights:analyze:${session.email}`,
      limit: PER_USER_RUNS_PER_HOUR,
      windowSeconds: 3600,
    },
    {
      key: `ratelimit:insights:analyze:site:${site}`,
      limit: GLOBAL_RUNS_PER_HOUR,
      windowSeconds: 3600,
    },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Překročen limit analýz. Zkuste to později.",
        retryAfter: limited.retryAfter,
      },
      { status: 429 }
    );
  }

  const now = new Date();
  const defaultTo = toDateString(addDays(weekStartOf(now), -7));
  const defaultFrom = toDateString(addDays(weekStartOf(now), -7 * 13));

  const scope: AnalysisScope = {
    siteId: site,
    weekStartFrom:
      typeof body.from === "string" && body.from ? body.from : defaultFrom,
    weekStartTo: typeof body.to === "string" && body.to ? body.to : defaultTo,
    sections: Array.isArray(body.sections)
      ? body.sections
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [],
    includePartialWeeks: body.includePartialWeeks === true,
    rankBy: body.rankBy === "visitorsSum" ? "visitorsSum" : "pageviews",
    topN:
      typeof body.topN === "number" && Number.isFinite(body.topN)
        ? Math.min(Math.max(20, Math.round(body.topN)), 600)
        : 300,
  };

  try {
    const out = await runInsightsAnalysis({
      scope,
      promptKey: typeof body.promptKey === "string" ? body.promptKey : null,
      modelKey: typeof body.modelKey === "string" ? body.modelKey : null,
      email: session.email,
    });
    return NextResponse.json(out);
  } catch (error) {
    if (error instanceof InsightsAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("insights analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analýza selhala." },
      { status: 502 }
    );
  }
}
