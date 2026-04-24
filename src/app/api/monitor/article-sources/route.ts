import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown, plausibleDayRange } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import {
  listLatestSourcesForArticle,
  listSourceTimeseriesForArticle,
} from "@/lib/monitor/queries";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60;

interface PlausibleSourceRow {
  source: string;
  visitors: number;
}

interface TimeseriesPoint {
  capturedAt: string;
  values: Record<string, number>;
}

function isExcluded(source: string, excluded: string[]): boolean {
  if (excluded.length === 0) return false;
  const needle = source.toLowerCase();
  return excluded.some((e) => {
    const pat = e.trim().toLowerCase();
    return pat.length > 0 && needle.includes(pat);
  });
}

function buildTimeseries(
  rows: { capturedAt: string; source: string; visitors: number }[],
  topSources: string[]
): TimeseriesPoint[] {
  const top = new Set(topSources);
  const byTime = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!top.has(r.source)) continue;
    const key =
      typeof r.capturedAt === "string"
        ? r.capturedAt
        : new Date(r.capturedAt as unknown as string | number | Date).toISOString();
    const values = byTime.get(key) ?? {};
    values[r.source] = r.visitors;
    byTime.set(key, values);
  }
  return Array.from(byTime.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([capturedAt, values]) => ({ capturedAt, values }));
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const requestedSite = sp.get("site");
  const site = requestedSite && isKnownSite(requestedSite) ? requestedSite : null;
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const pagePath = sp.get("path");
  if (!pagePath || !pagePath.startsWith("/")) {
    return NextResponse.json(
      { error: "Missing or invalid path" },
      { status: 400 }
    );
  }

  try {
    const cfg = await getMonitorConfig();
    const hoursParam = sp.get("hours");
    const hours = hoursParam
      ? Math.min(Math.max(1, Number(hoursParam)), 168)
      : cfg.windowHours;
    const excluded = cfg.excludedSources;

    if (cfg.sourceSamplingEnabled) {
      try {
        const raw = await listLatestSourcesForArticle(pagePath, hours, 30);
        const sources = raw
          .filter((s) => !isExcluded(s.source, excluded))
          .slice(0, 10);
        if (sources.length > 0) {
          let timeseries: TimeseriesPoint[] | undefined;
          let topSources: string[] | undefined;
          let timeseriesStatus:
            | "ok"
            | "disabled"
            | "not_enough_points"
            | "error"
            | "empty" = "disabled";
          let timeseriesPoints = 0;
          if (cfg.sourceTimeseriesEnabled) {
            topSources = sources.slice(0, 5).map((s) => s.source);
            try {
              const rawTs = await listSourceTimeseriesForArticle(
                pagePath,
                hours
              );
              const filtered = rawTs.filter(
                (r) => !isExcluded(r.source, excluded)
              );
              timeseries = buildTimeseries(filtered, topSources);
              timeseriesPoints = timeseries.length;
              timeseriesStatus =
                timeseries.length === 0
                  ? "empty"
                  : timeseries.length < 2
                  ? "not_enough_points"
                  : "ok";
            } catch (tsErr) {
              console.error(
                "article source timeseries fetch failed:",
                tsErr
              );
              timeseries = [];
              timeseriesStatus = "error";
            }
          }
          return NextResponse.json({
            pagePath,
            source: "db",
            sources,
            topSources,
            timeseries,
            timeseriesMeta: {
              status: timeseriesStatus,
              points: timeseriesPoints,
              samplingEnabled: cfg.sourceSamplingEnabled,
              timeseriesEnabled: cfg.sourceTimeseriesEnabled,
            },
          });
        }
      } catch (dbErr) {
        console.error("article DB sources fetch failed:", dbErr);
        // fall through to Plausible path
      }
    }

    const excludedKey = excluded.join("|");
    const key = `monitor:article-sources:${site}:${hours}:${pagePath}:excl:${excludedKey}`;
    try {
      const redis = getRedis();
      const cached = await redis.get(key);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
      const res = (await getBreakdown(site, {
        property: "visit:source",
        metrics: "visitors",
        ...plausibleDayRange(hours),
        filters: `event:page==${pagePath}`,
        limit: 15,
      })) as { results?: PlausibleSourceRow[] };
      const sources = (res.results || [])
        .map((r) => ({
          source: String(r.source),
          visitors: Number(r.visitors) || 0,
        }))
        .filter((s) => !isExcluded(s.source, excluded))
        .sort((a, b) => b.visitors - a.visitors)
        .slice(0, 10);
      const body = {
        pagePath,
        source: "plausible",
        sources,
        timeseriesMeta: {
          status: "no_stored_data" as const,
          points: 0,
          samplingEnabled: cfg.sourceSamplingEnabled,
          timeseriesEnabled: cfg.sourceTimeseriesEnabled,
        },
      };
      try {
        await redis.set(key, JSON.stringify(body), "EX", CACHE_TTL_SECONDS);
      } catch {
        // cache write is best-effort
      }
      return NextResponse.json(body);
    } catch (e) {
      console.error("article Plausible sources fetch failed:", e);
      return NextResponse.json({
        pagePath,
        source: "error",
        sources: [],
      });
    }
  } catch (fatal) {
    console.error("article-sources handler fatal:", fatal);
    return NextResponse.json({
      pagePath,
      source: "error",
      sources: [],
    });
  }
}
