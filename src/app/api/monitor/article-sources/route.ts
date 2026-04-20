import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown } from "@/lib/plausible";
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
    const values = byTime.get(r.capturedAt) ?? {};
    values[r.source] = r.visitors;
    byTime.set(r.capturedAt, values);
  }
  return Array.from(byTime.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
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

  const cfg = await getMonitorConfig();
  const hoursParam = sp.get("hours");
  const hours = hoursParam
    ? Math.min(Math.max(1, Number(hoursParam)), 168)
    : cfg.windowHours;
  const excluded = cfg.excludedSources;

  if (cfg.sourceSamplingEnabled) {
    const raw = await listLatestSourcesForArticle(pagePath, hours, 30);
    const sources = raw
      .filter((s) => !isExcluded(s.source, excluded))
      .slice(0, 10);
    if (sources.length > 0) {
      let timeseries: TimeseriesPoint[] | undefined;
      let topSources: string[] | undefined;
      if (cfg.sourceTimeseriesEnabled) {
        topSources = sources.slice(0, 5).map((s) => s.source);
        const rawTs = await listSourceTimeseriesForArticle(pagePath, hours);
        const filtered = rawTs.filter(
          (r) => !isExcluded(r.source, excluded)
        );
        timeseries = buildTimeseries(filtered, topSources);
      }
      return NextResponse.json({
        pagePath,
        source: "db",
        sources,
        topSources,
        timeseries,
      });
    }
    // fall through to on-demand if DB has nothing yet
  }

  const today = new Date().toISOString().slice(0, 10);
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
      period: "day",
      date: today,
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
    const body = { pagePath, source: "plausible", sources };
    await redis.set(key, JSON.stringify(body), "EX", CACHE_TTL_SECONDS);
    return NextResponse.json(body);
  } catch (e) {
    console.error("article sources fetch failed:", e);
    return NextResponse.json(
      { pagePath, source: "error", sources: [] },
      { status: 200 }
    );
  }
}
