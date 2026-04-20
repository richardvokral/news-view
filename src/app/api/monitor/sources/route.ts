import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { listPagePathsBySource } from "@/lib/monitor/queries";
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
      const plausiblePaths: string[] = [];
      let plausibleError: string | null = null;
      try {
        const res = (await getBreakdown(site, {
          property: "event:page",
          metrics: "visitors",
          period: "day",
          date: today,
          filters: `visit:source==${source}`,
          limit: 200,
        })) as { results?: PlausiblePageRow[] };
        for (const r of res.results || []) {
          const p = String(r.page);
          if (p) plausiblePaths.push(p);
        }
      } catch (e) {
        plausibleError = e instanceof Error ? e.message : String(e);
        console.error("sources plausible filter failed:", e);
      }

      let dbPaths: string[] = [];
      let dbError: string | null = null;
      try {
        dbPaths = await listPagePathsBySource(site, source, hours);
      } catch (e) {
        dbError = e instanceof Error ? e.message : String(e);
        console.error("sources DB filter failed:", e);
      }

      const pagePaths = Array.from(new Set([...plausiblePaths, ...dbPaths]));
      return {
        source,
        pagePaths,
        meta: {
          plausibleCount: plausiblePaths.length,
          dbCount: dbPaths.length,
          unionCount: pagePaths.length,
          plausibleError,
          dbError,
          fetchedAt: new Date().toISOString(),
        },
      };
    });
    return NextResponse.json(data);
  }

  const excludedKey = excluded.join("|");
  const key = `monitor:sources:${site}:${hours}:excl:${excludedKey}`;
  try {
    const data = await cachedJSON(key, async () => {
      let rawRows: PlausibleSourceRow[] = [];
      let fetchError: string | null = null;
      try {
        const res = (await getBreakdown(site, {
          property: "visit:source",
          metrics: "visitors",
          period: "day",
          date: today,
          limit: Math.max(50, cfg.topSourcesLimit + 20),
        })) as { results?: PlausibleSourceRow[] };
        rawRows = res.results || [];
      } catch (e) {
        fetchError = e instanceof Error ? e.message : String(e);
        console.error("top sources plausible fetch failed:", e);
      }
      const mapped = rawRows.map((r) => ({
        source: String(r.source),
        visitors: Number(r.visitors) || 0,
      }));
      const afterExclude = mapped.filter(
        (r) => !isExcluded(r.source, excluded)
      );
      const sources = afterExclude
        .sort((a, b) => b.visitors - a.visitors)
        .slice(0, cfg.topSourcesLimit);
      return {
        sources,
        meta: {
          rawCount: mapped.length,
          excludedCount: mapped.length - afterExclude.length,
          adminExcluded: excluded,
          error: fetchError,
          fetchedAt: new Date().toISOString(),
          site,
          hours,
        },
      };
    });
    return NextResponse.json(data);
  } catch (e) {
    console.error("sources handler fatal:", e);
    return NextResponse.json({
      sources: [],
      meta: {
        rawCount: 0,
        excludedCount: 0,
        adminExcluded: excluded,
        error: e instanceof Error ? e.message : String(e),
        fetchedAt: new Date().toISOString(),
        site,
        hours,
      },
    });
  }
}
