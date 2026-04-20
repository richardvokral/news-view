// Google Trends fetcher via scrape.do.
//
// scrape.do exposes Google's daily-trends JSON behind their proxy. The
// upstream Google endpoint returns a quirky payload prefixed with `)]}',`
// before valid JSON. We strip that prefix, parse, and pull the trending
// search titles + traffic estimate per locale.

import { getDb, hasDb } from "@/lib/db";

export interface TrendItem {
  title: string;
  traffic: string | null;
  url: string | null;
  newsTitle?: string | null;
  newsUrl?: string | null;
}

export interface TrendsSnapshot {
  locale: string;
  fetchedAt: string;
  source: string;
  data: TrendItem[];
  error: string | null;
}

const SCRAPE_DO_BASE = "https://api.scrape.do";

function buildTrendsUrl(locale: string): string {
  // Google's daily-trends payload — categorised by geo (CZ / DE / US ...).
  return `https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=0&geo=${encodeURIComponent(
    locale
  )}&ns=15`;
}

interface RawSummary {
  title?: { query?: string };
  formattedTraffic?: string;
  shareUrl?: string;
  articles?: Array<{ title?: string; url?: string }>;
}

interface RawDay {
  trendingSearches?: RawSummary[];
}

interface RawPayload {
  default?: { trendingSearchesDays?: RawDay[] };
}

function parseGoogleTrends(text: string): TrendItem[] {
  const cleaned = text.replace(/^[^\[{]*/, "").trim();
  let parsed: RawPayload;
  try {
    parsed = JSON.parse(cleaned) as RawPayload;
  } catch {
    return [];
  }
  const items: TrendItem[] = [];
  const days = parsed.default?.trendingSearchesDays ?? [];
  for (const day of days) {
    for (const t of day.trendingSearches ?? []) {
      const title = t.title?.query?.trim();
      if (!title) continue;
      items.push({
        title,
        traffic: t.formattedTraffic ?? null,
        url: t.shareUrl ?? null,
        newsTitle: t.articles?.[0]?.title ?? null,
        newsUrl: t.articles?.[0]?.url ?? null,
      });
    }
  }
  return items;
}

export async function fetchGoogleTrends(
  locale: string
): Promise<TrendsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const token = process.env.SCRAPE_DO_TOKEN;
  if (!token) {
    return {
      locale,
      fetchedAt,
      source: "scrape.do",
      data: [],
      error: "SCRAPE_DO_TOKEN not set",
    };
  }
  const target = buildTrendsUrl(locale);
  const url = `${SCRAPE_DO_BASE}/?token=${encodeURIComponent(
    token
  )}&url=${encodeURIComponent(target)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        locale,
        fetchedAt,
        source: "scrape.do",
        data: [],
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const text = await res.text();
    const data = parseGoogleTrends(text);
    return {
      locale,
      fetchedAt,
      source: "scrape.do",
      data,
      error: data.length === 0 ? "Empty response" : null,
    };
  } catch (e) {
    return {
      locale,
      fetchedAt,
      source: "scrape.do",
      data: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function persistSnapshot(snap: TrendsSnapshot): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO google_trends_snapshots (locale, fetched_at, source, data, error)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [snap.locale, snap.fetchedAt, snap.source, JSON.stringify(snap.data), snap.error]
  );
}

export async function getLatestSnapshot(
  locale: string
): Promise<TrendsSnapshot | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{
    locale: string;
    fetched_at: string | Date;
    source: string | null;
    data: TrendItem[] | null;
    error: string | null;
  }>(
    `SELECT locale, fetched_at, source, data, error
       FROM google_trends_snapshots
      WHERE locale = $1
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [locale]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    locale: r.locale,
    fetchedAt:
      r.fetched_at instanceof Date
        ? r.fetched_at.toISOString()
        : String(r.fetched_at),
    source: r.source ?? "scrape.do",
    data: Array.isArray(r.data) ? r.data : [],
    error: r.error,
  };
}

export async function pruneOldSnapshots(retentionDays: number): Promise<number> {
  if (!hasDb()) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const result = await getDb().query(
    `DELETE FROM google_trends_snapshots WHERE fetched_at < $1`,
    [cutoff]
  );
  return result.rowCount ?? 0;
}
