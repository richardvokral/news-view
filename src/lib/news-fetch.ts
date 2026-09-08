import { fetchAllNews } from "@/lib/fetchers";
import {
  storeArticles,
  pruneOldArticles,
  acquireFetchLock,
  releaseFetchLock,
  getLastFetchTime,
  ensureDbSchema,
} from "@/lib/storage/articles";
import { getApiConfig } from "@/lib/storage/settings";

export type FetchNewsResult =
  | { status: "busy" }
  | {
      status: "ok";
      fetched: number;
      stored: number;
      duplicates: number;
      pruned: number;
      timestamp: string;
    };

/**
 * One ingestion run: fetch every enabled source, store, prune.
 *
 * Shared by the cron endpoint (`/api/cron/fetch-news`, secret-authenticated)
 * and the signed-in "Fetch Now" button (`/api/news/fetch`, session + `news`
 * section), so the cron route never has to be reachable without a secret.
 * The Redis mutex means a concurrent caller gets `busy` instead of a second
 * run against the paid news APIs.
 */
export async function runFetchNews(): Promise<FetchNewsResult> {
  const locked = await acquireFetchLock();
  if (!locked) return { status: "busy" };

  try {
    await ensureDbSchema();

    const config = await getApiConfig();
    const lastFetch = await getLastFetchTime();
    const articles = await fetchAllNews(config, lastFetch);
    const { stored, duplicates } = await storeArticles(articles);
    const pruned = await pruneOldArticles();

    console.log(
      `Fetch complete: ${articles.length} fetched, ${stored} new, ${duplicates} duplicates, ${pruned} pruned`
    );

    return {
      status: "ok",
      fetched: articles.length,
      stored,
      duplicates,
      pruned,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await releaseFetchLock();
  }
}
