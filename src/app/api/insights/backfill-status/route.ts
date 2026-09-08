import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { getBackfillProgress } from "@/lib/insights/backfill";
import { getInsightsConfig, listWeekLedger } from "@/lib/insights/store";
import { isCompleteWeek, recentWeeks } from "@/lib/insights/weeks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Data freshness: which weeks are loaded, which are missing, what's running. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const site = request.nextUrl.searchParams.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const config = await getInsightsConfig();
  const ledger = await listWeekLedger(site);
  const byWeek = new Map(ledger.map((r) => [r.weekStart, r]));
  const now = new Date();

  const weeks = recentWeeks(config.backfillWeeks, now).map((w) => {
    const row = byWeek.get(w.weekStart);
    return {
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      complete: isCompleteWeek(w, now),
      status: row?.status ?? "missing",
      isPartial: row?.isPartial ?? false,
      truncated: row?.truncated ?? false,
      rows: row?.rowsWritten ?? 0,
      error: row?.error ?? null,
      fetchedAt: row?.fetchedAt ?? null,
    };
  });

  const loaded = weeks.filter((w) => w.status === "ok").length;
  const errored = weeks.filter((w) => w.status === "error").length;

  return NextResponse.json({
    site,
    backfillWeeks: config.backfillWeeks,
    weeksPerRequest: config.weeksPerRequest,
    loaded,
    errored,
    missing: weeks.length - loaded,
    metricsTier: ledger.find((r) => r.metricsTier !== null)?.metricsTier ?? null,
    weeks,
    progress: await getBackfillProgress(site),
  });
}
