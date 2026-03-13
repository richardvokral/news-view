import { ApiConfig, Fetcher, NormalizedArticle } from "./types";
import { createWorldNewsApiFetcher } from "./world-news-api";
import { createNewsDataHubFetcher } from "./newsdatahub";
import { createGNewsFetcher } from "./gnews";
import { createTwitterFetcher } from "./twitter";
import { extractKeywords } from "../clustering/tokenizer";

function getEnabledFetchers(config: ApiConfig): Fetcher[] {
  const fetchers: Fetcher[] = [];

  if (config.worldNewsApi.enabled && config.worldNewsApi.apiKey) {
    fetchers.push(createWorldNewsApiFetcher(config.worldNewsApi.apiKey));
  }
  if (config.newsDataHub.enabled && config.newsDataHub.apiKey) {
    fetchers.push(createNewsDataHubFetcher(config.newsDataHub.apiKey));
  }
  if (config.gnews.enabled && config.gnews.apiKey) {
    fetchers.push(createGNewsFetcher(config.gnews.apiKey));
  }
  if (config.twitter.enabled && config.twitter.bearerToken) {
    fetchers.push(createTwitterFetcher(config.twitter.bearerToken));
  }

  return fetchers;
}

export async function fetchAllNews(
  config: ApiConfig
): Promise<NormalizedArticle[]> {
  const fetchers = getEnabledFetchers(config);
  const countries: ("us" | "de")[] = ["us", "de"];

  const promises = fetchers.flatMap((fetcher) =>
    countries.map(async (country) => {
      try {
        const articles = await fetcher.fetch(country);
        console.log(
          `${fetcher.name} [${country}]: fetched ${articles.length} articles`
        );
        return articles;
      } catch (error) {
        console.error(`${fetcher.name} [${country}] failed:`, error);
        return [];
      }
    })
  );

  const results = await Promise.allSettled(promises);
  const allArticles: NormalizedArticle[] = [];
  const seenIds = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const article of result.value) {
        if (!seenIds.has(article.id)) {
          seenIds.add(article.id);
          article.keywords = extractKeywords(article.title);
          allArticles.push(article);
        }
      }
    }
  }

  return allArticles;
}
