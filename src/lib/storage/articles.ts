import { getRedis } from "../redis";
import { NormalizedArticle } from "../fetchers/types";

const ARTICLES_KEY = "articles:all";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FETCH_LAST_KEY = "fetch:last";
const FETCH_LOCK_KEY = "fetch:lock";

export async function storeArticles(
  articles: NormalizedArticle[]
): Promise<number> {
  const redis = getRedis();
  if (articles.length === 0) return 0;

  // Use pipeline for batch ZADD
  const pipeline = redis.pipeline();
  for (const article of articles) {
    pipeline.zadd(
      ARTICLES_KEY,
      new Date(article.publishedAt).getTime(),
      JSON.stringify(article)
    );
  }
  await pipeline.exec();
  await redis.set(FETCH_LAST_KEY, new Date().toISOString());
  return articles.length;
}

export async function getArticles(
  sinceDaysAgo: number = 3
): Promise<NormalizedArticle[]> {
  const redis = getRedis();
  const since = Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000;

  // Use zrangebyscore to get articles newer than `since`
  const results = await redis.zrangebyscore(ARTICLES_KEY, since, "+inf");

  return results.map((item: string) => JSON.parse(item));
}

export async function pruneOldArticles(): Promise<number> {
  const redis = getRedis();
  const cutoff = Date.now() - THREE_DAYS_MS;
  return await redis.zremrangebyscore(ARTICLES_KEY, 0, cutoff);
}

export async function getLastFetchTime(): Promise<string | null> {
  const redis = getRedis();
  return await redis.get(FETCH_LAST_KEY);
}

export async function acquireFetchLock(): Promise<boolean> {
  const result = await getRedis().set(FETCH_LOCK_KEY, "1", "EX", 60, "NX");
  return result === "OK";
}

export async function releaseFetchLock(): Promise<void> {
  const redis = getRedis();
  await redis.del(FETCH_LOCK_KEY);
}
