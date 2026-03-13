import { Fetcher, NormalizedArticle } from "./types";
import { hashId } from "./utils";
import { getRedis } from "../redis";

interface GNewsArticle {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  image?: string;
  publishedAt?: string;
  source?: { name?: string; url?: string; country?: string };
}

interface GNewsResponse {
  totalArticles?: number;
  articles?: GNewsArticle[];
}

async function checkGNewsRateLimit(): Promise<boolean> {
  const redis = getRedis();
  const today = new Date().toISOString().split("T")[0];
  const key = `gnews:requests:${today}`;
  const count = (await redis.get<number>(key)) ?? 0;
  return count < 90;
}

async function incrementGNewsCounter(): Promise<void> {
  const redis = getRedis();
  const today = new Date().toISOString().split("T")[0];
  const key = `gnews:requests:${today}`;
  await redis.incr(key);
  await redis.expire(key, 172800); // 2 days
}

export function createGNewsFetcher(apiKey: string): Fetcher {
  return {
    name: "gnews",
    async fetch(country) {
      const withinLimit = await checkGNewsRateLimit();
      if (!withinLimit) {
        console.log("GNews daily rate limit reached, skipping");
        return [];
      }

      const langMap = { us: "en", de: "de" };
      const url = `https://gnews.io/api/v4/top-headlines?category=general&country=${country}&lang=${langMap[country]}&apikey=${apiKey}`;

      const res = await fetch(url);
      if (!res.ok) {
        console.error(`GNews error: ${res.status} ${await res.text()}`);
        return [];
      }

      await incrementGNewsCounter();
      const data: GNewsResponse = await res.json();
      const articles: NormalizedArticle[] = [];

      for (const item of data.articles ?? []) {
        if (!item.url || !item.title) continue;
        articles.push({
          id: hashId(item.url),
          title: item.title,
          summary: item.description ?? "",
          url: item.url,
          imageUrl: item.image ?? null,
          publishedAt: item.publishedAt ?? new Date().toISOString(),
          source: "gnews",
          sourceCountry: country,
          category: null,
          keywords: [],
        });
      }

      return articles;
    },
  };
}
