import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { rateLimitAll } from "@/lib/rate-limit";
import { runTitleRewrite, TitleRunError } from "@/lib/insights/titleRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PEREX_CHARS = 2000;

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
  const title = typeof body.title === "string" ? body.title : "";
  if (!title.trim()) {
    return NextResponse.json({ error: "Zadejte titulek." }, { status: 400 });
  }
  const perex = typeof body.perex === "string" ? body.perex : "";
  if (perex.length > MAX_PEREX_CHARS) {
    return NextResponse.json({ error: "Perex je příliš dlouhý." }, { status: 413 });
  }
  const playbookKey = typeof body.playbookKey === "string" ? body.playbookKey : "";
  if (!playbookKey) {
    return NextResponse.json({ error: "Vyberte playbook." }, { status: 400 });
  }

  // Cheap per call, but trivially spammable — it is still a paid LLM request.
  const limited = await rateLimitAll([
    { key: `ratelimit:insights:rewrite:${session.email}`, limit: 60, windowSeconds: 3600 },
    { key: `ratelimit:insights:rewrite:site:${site}`, limit: 200, windowSeconds: 3600 },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Překročen limit přepisů. Zkuste to později.", retryAfter: limited.retryAfter },
      { status: 429 }
    );
  }

  try {
    const out = await runTitleRewrite({
      siteId: site,
      title,
      section: typeof body.section === "string" ? body.section : null,
      perex: perex || null,
      playbookKey,
      modelKey: typeof body.modelKey === "string" ? body.modelKey : null,
      email: session.email,
    });
    return NextResponse.json(out);
  } catch (error) {
    if (error instanceof TitleRunError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("title rewrite failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Přepis selhal." },
      { status: 502 }
    );
  }
}
