// Minimal RSS 2.0 fetcher/parser. Extracts title, link, and the first image
// enclosure from each <item>. No external XML dependency: RSS feeds are
// simple and the patterns we rely on (CDATA titles, enclosure tags with
// image/* types) are well-supported across Czech news publishers that this
// app targets.

export interface RssItem {
  title: string;
  link: string;
  pagePath: string;
  imageUrl: string | null;
  pubDate: string | null;
}

export interface RssFeedResult {
  items: RssItem[];
  fetchedAt: Date;
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
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i"
  );
  const m = block.match(re);
  if (!m) return null;
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value);
}

function extractEnclosureImage(block: string): string | null {
  const re = /<enclosure\s+[^>]*\burl="([^"]+)"[^>]*\btype="image\/[^"]+"/i;
  const m = block.match(re);
  if (m) return m[1];
  const reFlipped = /<enclosure\s+[^>]*\btype="image\/[^"]+"[^>]*\burl="([^"]+)"/i;
  const m2 = block.match(reFlipped);
  if (m2) return m2[1];
  const szn = block.match(/<szn:image[^>]*>([\s\S]*?)<\/szn:image>/i);
  if (szn) return szn[1].trim();
  return null;
}

function linkToPagePath(link: string): string | null {
  try {
    const u = new URL(link);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return path;
  } catch {
    if (link.startsWith("/")) return link.replace(/\/+$/, "") || "/";
    return null;
  }
}

/**
 * Parse an RSS 2.0 XML string into items. Unknown/malformed items are skipped.
 */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title") ?? "";
    const link = extractTag(block, "link") ?? "";
    const pubDate = extractTag(block, "pubDate");
    const imageUrl = extractEnclosureImage(block);
    const pagePath = link ? linkToPagePath(link) : null;
    if (!title || !pagePath) continue;
    items.push({
      title,
      link,
      pagePath,
      imageUrl,
      pubDate,
    });
  }
  return items;
}

/**
 * Fetch and parse an RSS feed. Returns an empty result on network or parse
 * failure so callers can degrade gracefully.
 */
export async function fetchRssFeed(url: string): Promise<RssFeedResult> {
  const fetchedAt = new Date();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "news-view-monitor/1.0",
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`RSS fetch failed: ${url} (HTTP ${res.status})`);
      return { items: [], fetchedAt };
    }
    const xml = await res.text();
    return { items: parseRss(xml), fetchedAt };
  } catch (e) {
    console.warn(`RSS fetch error: ${url}`, e);
    return { items: [], fetchedAt };
  }
}
