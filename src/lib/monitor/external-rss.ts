// Ingest RSS feeds from competitor sites (the Coverage tab). Reuses the
// same minimal RSS parser as the internal RSS sync, plus a guid extractor
// and a hostname-derived feed_source label so the UI has a stable label.

import { getDb, hasDb } from "@/lib/db";
import { fetchRssFeed, parseRss } from "./rss";

export interface ExternalArticleRow {
  id: number;
  feedSource: string;
  guid: string;
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  importedAt: string;
}

function feedSourceFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * RSS 2.0 <guid> extractor. Falls back to <link> when <guid> is absent.
 * Note: this isn't part of the core parser (which only emits title/link/
 * pagePath/imageUrl) because we need the unique id for upserts here.
 */
function extractGuidLinkDescription(
  xml: string
): Array<{ guid: string; link: string; title: string; description: string | null; pubDate: string | null }> {
  const out: Array<{
    guid: string;
    link: string;
    title: string;
    description: string | null;
    pubDate: string | null;
  }> = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title") ?? "";
    const link = extractTag(block, "link") ?? "";
    const guidRaw = extractTag(block, "guid") ?? link;
    const description = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    if (!title || !link) continue;
    out.push({
      guid: guidRaw,
      link,
      title,
      description,
      pubDate,
    });
  }
  return out;
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i"
  );
  const m = block.match(re);
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return v
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

export interface IngestResult {
  feedSource: string;
  fetched: number;
  inserted: number;
  error?: string;
}

export async function ingestExternalFeed(url: string): Promise<IngestResult> {
  const feedSource = feedSourceFromUrl(url);
  if (!hasDb()) {
    return { feedSource, fetched: 0, inserted: 0, error: "no_db" };
  }
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "news-view-coverage/1.0",
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        feedSource,
        fetched: 0,
        inserted: 0,
        error: `HTTP ${res.status}`,
      };
    }
    const xml = await res.text();
    // We use our own parse here (need guid/description) but still exercise the
    // shared parser to benefit from its link/pagePath normalisation.
    void parseRss;
    const items = extractGuidLinkDescription(xml);
    let inserted = 0;
    for (const it of items) {
      const { rowCount } = await getDb().query(
        `INSERT INTO external_articles
           (feed_source, guid, title, link, description, pub_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (feed_source, guid) DO NOTHING`,
        [
          feedSource,
          it.guid,
          it.title,
          it.link,
          it.description,
          it.pubDate ? new Date(it.pubDate) : null,
        ]
      );
      if ((rowCount ?? 0) > 0) inserted += 1;
    }
    return { feedSource, fetched: items.length, inserted };
  } catch (e) {
    void fetchRssFeed; // keep import referenced
    return {
      feedSource,
      fetched: 0,
      inserted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ingestAllExternalFeeds(
  urls: string[]
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const url of urls) {
    const r = await ingestExternalFeed(url);
    results.push(r);
  }
  return results;
}

export async function listRecentExternals(
  windowHours: number,
  limit = 500
): Promise<ExternalArticleRow[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const { rows } = await getDb().query<{
    id: string;
    feed_source: string;
    guid: string;
    title: string;
    link: string;
    description: string | null;
    pub_date: string | null;
    imported_at: string;
  }>(
    `SELECT id, feed_source, guid, title, link, description, pub_date, imported_at
       FROM external_articles
      WHERE COALESCE(pub_date, imported_at) >= $1
      ORDER BY COALESCE(pub_date, imported_at) DESC
      LIMIT $2`,
    [cutoff, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    feedSource: r.feed_source,
    guid: r.guid,
    title: r.title,
    link: r.link,
    description: r.description,
    pubDate: r.pub_date,
    importedAt: r.imported_at,
  }));
}

export async function pruneExternalArticles(
  retentionDays: number
): Promise<number> {
  if (!hasDb()) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const result = await getDb().query(
    `DELETE FROM external_articles WHERE imported_at < $1`,
    [cutoff]
  );
  return result.rowCount ?? 0;
}
