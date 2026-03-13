import { Fetcher, NormalizedArticle } from "./types";
import { hashId } from "./utils";

interface NewsDataHubArticle {
  title?: string;
  description?: string;
  url?: string;
  image_url?: string;
  published_at?: string;
  category?: string;
  country?: string;
}

interface NewsDataHubResponse {
  data?: NewsDataHubArticle[];
}

export function createNewsDataHubFetcher(apiKey: string): Fetcher {
  return {
    name: "newsdatahub",
    async fetch(country) {
      const url = `https://api.newsdatahub.com/v1/news?country=${country.toUpperCase()}&language=${country === "us" ? "en" : "de"}`;

      const res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
      });

      if (!res.ok) {
        console.error(
          `NewsDataHub error: ${res.status} ${await res.text()}`
        );
        return [];
      }

      const data: NewsDataHubResponse = await res.json();
      const articles: NormalizedArticle[] = [];

      for (const item of data.data ?? []) {
        if (!item.url || !item.title) continue;
        articles.push({
          id: hashId(item.url),
          title: item.title,
          summary: item.description ?? "",
          url: item.url,
          imageUrl: item.image_url ?? null,
          publishedAt: item.published_at ?? new Date().toISOString(),
          source: "newsdatahub",
          sourceCountry: country,
          category: item.category ?? null,
          keywords: [],
        });
      }

      return articles;
    },
  };
}
