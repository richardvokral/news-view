import { Fetcher, NormalizedArticle } from "./types";
import { hashId } from "./utils";

interface WorldNewsArticle {
  title?: string;
  text?: string;
  url?: string;
  image?: string;
  publish_date?: string;
  category?: string;
  source_country?: string;
}

interface WorldNewsResponse {
  top_news?: Array<{ news?: WorldNewsArticle[] }>;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesAreSimilar(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const wordsA = new Set(na.split(" ").filter((w) => w.length > 3));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const similarity = overlap / Math.min(wordsA.size, wordsB.size);
  return similarity >= 0.7;
}

export function createWorldNewsApiFetcher(apiKey: string): Fetcher {
  return {
    name: "worldnewsapi",
    async fetch(country, since) {
      const langMap = { us: "en", de: "de" };
      let url = `https://api.worldnewsapi.com/top-news?source-country=${country}&language=${langMap[country]}&api-key=${apiKey}`;
      if (since) {
        url += `&earliest-publish-date=${encodeURIComponent(since)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        console.error(
          `WorldNewsAPI error: ${res.status} ${await res.text()}`
        );
        return [];
      }

      const data: WorldNewsResponse = await res.json();
      const articles: NormalizedArticle[] = [];

      for (const group of data.top_news ?? []) {
        for (const item of group.news ?? []) {
          if (!item.url || !item.title) continue;

          const isDuplicate = articles.some((existing) =>
            titlesAreSimilar(existing.title, item.title!)
          );
          if (isDuplicate) continue;

          articles.push({
            id: hashId(item.url),
            title: item.title,
            summary: item.text?.slice(0, 300) ?? "",
            url: item.url,
            imageUrl: item.image ?? null,
            publishedAt:
              item.publish_date ?? new Date().toISOString(),
            source: "worldnewsapi",
            sourceCountry: country,
            category: item.category ?? null,
            keywords: [],
          });
        }
      }

      const beforeDedup = articles.length;
      if (beforeDedup > 0) {
        console.log(`WorldNewsAPI [${country}]: kept ${articles.length} unique articles (deduped from raw results)`);
      }

      return articles;
    },
  };
}
