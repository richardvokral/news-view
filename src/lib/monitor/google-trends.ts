// Google Trends fetcher.
//
// Google deprecated the legacy /trends/api/dailytrends JSON endpoint (it now
// returns 404). Their current public surface for daily trending searches is
// the RSS feed at `https://trends.google.com/trending/rss?geo=XX`, which is
// accessible without auth. We try a direct fetch first (free, fast) and only
// fall back to scrape.do if that fails or returns a consent/blocked page —
// this keeps the scrape.do quota for cases where the direct request gets
// geo-blocked or served a consent wall.
//
// We parse the Google-specific `ht:` namespaced tags to extract approximate
// traffic and the first related news item per trend.

import { getDb, hasDb } from "@/lib/db";

export interface TrendItem {
  title: string;
  traffic: string | null;
  url: string | null;
  newsTitle?: string | null;
  newsUrl?: string | null;
  newsSource?: string | null;
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
  return `https://trends.google.com/trending/rss?geo=${encodeURIComponent(
    locale
  )}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

function extractTag(block: string, tag: string): string | null {
  // Escape the `:` in namespaced tag names like `ht:approx_traffic`.
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`,
    "i"
  );
  const m = block.match(re);
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return decodeEntities(v);
}

export function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title");
    if (!title) continue;
    const traffic = extractTag(block, "ht:approx_traffic");
    const link = extractTag(block, "link");
    const firstNews = block.match(
      /<ht:news_item\b[\s\S]*?<\/ht:news_item>/i
    );
    const newsBlock = firstNews?.[0];
    const newsTitle = newsBlock ? extractTag(newsBlock, "ht:news_item_title") : null;
    const newsUrl = newsBlock ? extractTag(newsBlock, "ht:news_item_url") : null;
    const newsSource = newsBlock
      ? extractTag(newsBlock, "ht:news_item_source")
      : null;
    items.push({
      title,
      traffic: traffic ?? null,
      url: link ?? null,
      newsTitle: newsTitle ?? null,
      newsUrl: newsUrl ?? null,
      newsSource: newsSource ?? null,
    });
  }
  return items;
}

interface AttemptResult {
  ok: boolean;
  data: TrendItem[];
  error: string | null;
  body?: string;
}

async function tryFetch(url: string): Promise<AttemptResult> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; news-view-monitor/1.0; +https://example.com)",
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        data: [],
        error: `HTTP ${res.status}: ${body.slice(0, 160)}`,
        body,
      };
    }
    const text = await res.text();
    // Detect Google consent interstitials / non-RSS bodies.
    const looksLikeRss = text.includes("<item") && text.includes("<rss");
    if (!looksLikeRss) {
      return {
        ok: false,
        data: [],
        error: "Non-RSS body (consent page or block)",
        body: text,
      };
    }
    const data = parseTrendsRss(text);
    return {
      ok: true,
      data,
      error: data.length === 0 ? "Parsed 0 items" : null,
      body: text,
    };
  } catch (e) {
    return {
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchGoogleTrends(
  locale: string
): Promise<TrendsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const target = buildTrendsUrl(locale);

  // 1. Direct fetch — free, fast, usually works.
  const direct = await tryFetch(target);
  if (direct.ok && direct.data.length > 0) {
    return {
      locale,
      fetchedAt,
      source: "google-direct",
      data: direct.data,
      error: null,
    };
  }

  // 2. Fall back to scrape.do if the direct call failed or returned no items
  //    and a token is configured. Bubbles up direct-fetch error otherwise so
  //    the UI can explain why the snapshot is empty.
  const token = process.env.SCRAPE_DO_TOKEN;
  if (!token) {
    return {
      locale,
      fetchedAt,
      source: "google-direct",
      data: direct.data,
      error:
        direct.error ??
        "No items. Set SCRAPE_DO_TOKEN to enable the fallback proxy.",
    };
  }
  const proxied = await tryFetch(
    `${SCRAPE_DO_BASE}/?token=${encodeURIComponent(
      token
    )}&url=${encodeURIComponent(target)}`
  );
  if (proxied.ok && proxied.data.length > 0) {
    return {
      locale,
      fetchedAt,
      source: "scrape.do",
      data: proxied.data,
      error: null,
    };
  }
  return {
    locale,
    fetchedAt,
    source: "scrape.do",
    data: proxied.data,
    error:
      proxied.error ??
      direct.error ??
      "Unknown error fetching trends",
  };
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
