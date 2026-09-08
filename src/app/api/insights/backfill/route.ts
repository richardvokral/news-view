import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { rateLimitAll } from "@/lib/rate-limit";
import { runInsightsBackfill, startRun } from "@/lib/insights/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Next requires a literal here, so it can't reference the constant directly.
// Keep in sync with BACKFILL_MAX_DURATION_S in src/lib/insights/backfill.ts,
// which derives the loop deadline from the same number.
export const maxDuration = 300;

// The insights grant may spend Plausible quota, so limits are the guard.
// The in-run call budget and the Redis lock are the harder backstops.
const PER_USER_RUNS_PER_HOUR = 5;
const GLOBAL_RUNS_PER_HOUR = 20;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { site?: unknown; weeks?: unknown; runKey?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const site = typeof body.site === "string" ? body.site : "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const limited = await rateLimitAll([
    {
      key: `ratelimit:insights:backfill:${session.email}`,
      limit: PER_USER_RUNS_PER_HOUR,
      windowSeconds: 3600,
    },
    {
      key: `ratelimit:insights:backfill:site:${site}`,
      limit: GLOBAL_RUNS_PER_HOUR,
      windowSeconds: 3600,
    },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Příliš mnoho načítání. Zkuste to později.",
        retryAfter: limited.retryAfter,
      },
      { status: 429 }
    );
  }

  const weeks =
    typeof body.weeks === "number" && Number.isFinite(body.weeks)
      ? Math.min(Math.max(1, Math.round(body.weeks)), 8)
      : undefined;
  const runKey =
    typeof body.runKey === "string" && body.runKey.trim()
      ? body.runKey.trim().slice(0, 64)
      : randomBytes(8).toString("hex");

  await startRun(runKey, site, session.email);

  try {
    const result = await runInsightsBackfill(site, {
      weeks,
      runKey,
      startedBy: session.email,
    });
    // 200 even when the run aborted: it partially succeeded and the client
    // needs the payload to show what landed. `ok` carries the outcome.
    return NextResponse.json(result);
  } catch (error) {
    console.error("insights backfill failed:", error);
    return NextResponse.json(
      { error: "Backfill failed", ok: false, runKey },
      { status: 500 }
    );
  }
}
