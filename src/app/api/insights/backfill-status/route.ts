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

  // The panel can scope itself to a shorter horizon than the configured depth.
  // The counts have to follow, or a 4-week load shows a 15%-full progress bar.
  // `Number(null)` and `Number("")` are both 0, which is finite — so an absent
  // param would otherwise clamp to a one-week horizon instead of the default.
  const askedRaw = request.nextUrl.searchParams.get("weeks");
  const askedHorizon = askedRaw ? Number(askedRaw) : NaN;
  const horizonWeeks =
    Number.isFinite(askedHorizon) && askedHorizon > 0
      ? Math.min(Math.max(1, Math.round(askedHorizon)), config.backfillWeeks)
      : config.backfillWeeks;

  const describe = (w: { weekStart: string; weekEnd: string }) => {
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
  };

  const allWeeks = recentWeeks(config.backfillWeeks, now).map(describe);
  const weeks = allWeeks.slice(0, horizonWeeks);

  const loaded = weeks.filter((w) => w.status === "ok").length;
  const errored = weeks.filter((w) => w.status === "error").length;

  return NextResponse.json({
    site,
    backfillWeeks: config.backfillWeeks,
    horizonWeeks,
    weeksPerRequest: config.weeksPerRequest,
    // Without a path filter the backfill pages through every URL with traffic,
    // which is the usual reason a load crawls. The panel offers the fix.
    pathFilterSet: config.articlePathFilter.trim().length > 0,
    loaded,
    errored,
    missing: weeks.length - loaded,
    totalWeeks: allWeeks.length,
    totalLoaded: allWeeks.filter((w) => w.status === "ok").length,
    metricsTier: ledger.find((r) => r.metricsTier !== null)?.metricsTier ?? null,
    weeks,
    progress: await getBackfillProgress(site),
  });
}
