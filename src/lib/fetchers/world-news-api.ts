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

      return articles;
    },
  };
}
