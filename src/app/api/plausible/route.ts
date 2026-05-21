import { NextRequest, NextResponse } from "next/server";
import {
  getAggregate,
  getTimeseries,
  getBreakdown,
  getRealtimeVisitors,
  isKnownSite,
  defaultSiteId,
} from "@/lib/plausible";
import {
  VALID_PERIODS,
  MAX_LIMIT,
  validateMetrics,
} from "@/lib/plausible-validate";

// Session is verified by middleware (cookie check at the edge).
// This route is called 10+ times per dashboard render, so we skip DB-backed
// section resolution here and rely on the middleware gate.

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const requestedSite = searchParams.get("site") || defaultSiteId();
  if (!requestedSite || !isKnownSite(requestedSite)) {
    return NextResponse.json(
      { error: "Unknown site. Configure PLAUSIBLE_SITE_IDS." },
      { status: 400 }
    );
  }

  const metrics = searchParams.get("metrics") || "visitors";
  const period = searchParams.get("period") || undefined;

  if (!validateMetrics(metrics)) {
    return NextResponse.json({ error: "Invalid metrics" }, { status: 400 });
  }
  if (period && !VALID_PERIODS.has(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  try {
    let data: unknown;
    switch (endpoint) {
      case "aggregate":
        data = await getAggregate(requestedSite, {
          metrics,
          period,
          date: searchParams.get("date") || undefined,
          filters: searchParams.get("filters") || undefined,
        });
        break;
      case "timeseries":
        data = await getTimeseries(requestedSite, {
          metrics,
          period,
          date: searchParams.get("date") || undefined,
          filters: searchParams.get("filters") || undefined,
          interval: searchParams.get("interval") || undefined,
        });
        break;
      case "breakdown": {
        const rawLimit = searchParams.get("limit");
        const limit = rawLimit
          ? Math.min(Number(rawLimit), MAX_LIMIT)
          : undefined;
        data = await getBreakdown(requestedSite, {
          property: searchParams.get("property") || "event:page",
          metrics,
          period,
          date: searchParams.get("date") || undefined,
          filters: searchParams.get("filters") || undefined,
          limit,
        });
        break;
      }
      case "realtime":
        data = await getRealtimeVisitors(requestedSite);
        break;
      default:
        return NextResponse.json(
          { error: "Unknown endpoint" },
          { status: 400 }
        );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error(
      "Plausible API error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Upstream API error" }, { status: 502 });
  }
}
