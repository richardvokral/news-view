import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60;

interface PlausibleSourceRow {
  source: string;
  visitors: number;
}

interface PlausiblePageRow {
  page: string;
  visitors: number;
}

async function cachedJSON<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const redis = getRedis();
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as T;
    const fresh = await fetcher();
    await redis.set(key, JSON.stringify(fresh), "EX", CACHE_TTL_SECONDS);
    return fresh;
  } catch {
    return fetcher();
  }
}

function isExcluded(source: string, excluded: string[]): boolean {
  if (excluded.length === 0) return false;
  const needle = source.toLowerCase();
  return excluded.some((e) => {
    const pat = e.trim().toLowerCase();
    return pat.length > 0 && needle.includes(pat);
  });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const requestedSite = params.get("site");
  const site = requestedSite && isKnownSite(requestedSite) ? requestedSite : null;
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const cfg = await getMonitorConfig();
  const defaultWindow = cfg.windowHours;
  const excluded = cfg.excludedSources;
  const hoursParam = params.get("hours");
  const hours = hoursParam
    ? Math.min(Math.max(1, Number(hoursParam)), 168)
    : defaultWindow;
  const source = params.get("source");
  const today = new Date().toISOString().slice(0, 10);

  if (source) {
    const key = `monitor:sources:${site}:${hours}:${source}`;
    const data = await cachedJSON(key, async () => {
      const res = (await getBreakdown(site, {
        property: "event:page",
        metrics: "visitors",
        period: "day",
        date: today,
        filters: `visit:source==${source}`,
        limit: 200,
      })) as { results?: PlausiblePageRow[] };
      const pagePaths = (res.results || [])
        .map((r) => String(r.page))
        .filter(Boolean);
      return { source, pagePaths };
    });
    return NextResponse.json(data);
  }

  const excludedKey = excluded.join("|");
  const key = `monitor:sources:${site}:${hours}:excl:${excludedKey}`;
  const data = await cachedJSON(key, async () => {
    const res = (await getBreakdown(site, {
      property: "visit:source",
      metrics: "visitors",
      period: "day",
      date: today,
      limit: 30,
    })) as { results?: PlausibleSourceRow[] };
    const sources = (res.results || [])
      .map((r) => ({
        source: String(r.source),
        visitors: Number(r.visitors) || 0,
      }))
      .filter((r) => !isExcluded(r.source, excluded))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 20);
    return { sources };
  });
  return NextResponse.json(data);
}
