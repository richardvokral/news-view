import { Fetcher, NormalizedArticle, RssFeedConfig } from "./types";
import { hashId } from "./utils";

interface RssFeedDef {
  key: keyof RssFeedConfig;
  name: string;
  country: "us" | "de";
  url: string;
}

const RSS_FEEDS: RssFeedDef[] = [
  {
    key: "guardian",
    name: "The Guardian",
    country: "us",
    url: "https://www.theguardian.com/world/rss",
  },
  {
    key: "dw",
    name: "DW (EN)",
    country: "de",
    url: "https://rss.dw.com/rdf/rss-en-all",
  },
  {
    key: "spiegel",
    name: "Spiegel",
    country: "de",
    url: "https://www.spiegel.de/international/index.rss",
  },
  {
    key: "foxNews",
    name: "Fox News",
    country: "us",
    url: "https://moxie.foxnews.com/google-publisher/world.xml",
  },
  {
    key: "reuters",
    name: "Reuters",
    country: "us",
    url: "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best",
  },
];

export function createRssFetchers(config: RssFeedConfig): Fetcher[] {
  const fetchers: Fetcher[] = [];

  for (const feed of RSS_FEEDS) {
    if (!config[feed.key]) continue;

    fetchers.push({
      name: `rss-${feed.key}`,
      async fetch(country) {
        if (country !== feed.country) return [];

        try {
          const articles = await fetchRssFeed(feed.url, feed.name, country);
          return articles;
        } catch (error) {
          console.error(`RSS ${feed.name} failed:`, error);
          return [];
        }
      },
    });
  }

  return fetchers;
}

async function fetchRssFeed(
  feedUrl: string,
  sourceName: string,
  country: "us" | "de"
): Promise<NormalizedArticle[]> {
  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": "NewsView/1.0 (RSS Reader)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!res.ok) {
    console.error(`RSS ${sourceName}: HTTP ${res.status}`);
    return [];
  }

  const xml = await res.text();
  return parseRssXml(xml, sourceName, country);
}

function parseRssXml(
  xml: string,
  sourceName: string,
  country: "us" | "de"
): NormalizedArticle[] {
  const articles: NormalizedArticle[] = [];

  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const item of items) {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link") || extractGuid(item);
    const description = extractTag(item, "description");
    const pubDate = extractTag(item, "pubDate") || extractTag(item, "dc:date");

    if (!title || !link) continue;

    const cleanTitle = stripCdata(stripHtml(title));
    const cleanDesc = stripCdata(stripHtml(description || ""));

    const imageUrl = extractMediaImage(item);

    articles.push({
      id: hashId(link),
      title: cleanTitle,
      summary: cleanDesc.slice(0, 300),
      url: link,
      imageUrl,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source: "rss",
      sourceCountry: country,
      category: extractTag(item, "category"),
      keywords: [],
    });
  }

  return articles.slice(0, 30);
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractGuid(xml: string): string | null {
  const match = xml.match(/<guid[^>]*>([^<]+)<\/guid>/i);
  return match ? match[1].trim() : null;
}

function extractMediaImage(xml: string): string | null {
  const mediaMatch = xml.match(/<media:content[^>]+url="([^"]+)"/i)
    ?? xml.match(/<media:thumbnail[^>]+url="([^"]+)"/i)
    ?? xml.match(/<enclosure[^>]+url="([^"]+)"[^>]+type="image/i);
  return mediaMatch ? mediaMatch[1] : null;
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
