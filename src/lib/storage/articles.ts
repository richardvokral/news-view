import { getRedis } from "../redis";
import { hasDb, getDb } from "../db";
import { NormalizedArticle } from "../fetchers/types";

const ARTICLES_KEY = "articles:all";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FETCH_LAST_KEY = "fetch:last";
const FETCH_LOCK_KEY = "fetch:lock";

export async function storeArticles(
  articles: NormalizedArticle[]
): Promise<{ stored: number; duplicates: number }> {
  if (articles.length === 0) return { stored: 0, duplicates: 0 };

  let stored = articles.length;
  let duplicates = 0;

  if (hasDb()) {
    const result = await storeArticlesDb(articles);
    stored = result.inserted;
    duplicates = result.duplicates;
  }

  // Always write to Redis cache too
  const redis = getRedis();
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

  return { stored, duplicates };
}

async function storeArticlesDb(
  articles: NormalizedArticle[]
): Promise<{ inserted: number; duplicates: number }> {
  const db = getDb();
  let inserted = 0;

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const a of articles) {
    values.push(
      `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`
    );
    params.push(
      a.id,
      a.title,
      a.summary,
      a.url,
      a.imageUrl,
      a.publishedAt,
      a.source,
      a.sourceCountry,
      a.category,
      a.keywords
    );
    paramIdx += 10;
  }

  const query = `
    INSERT INTO articles (id, title, summary, url, image_url, published_at, source, source_country, category, keywords)
    VALUES ${values.join(", ")}
    ON CONFLICT (url) DO NOTHING
  `;

  const result = await db.query(query, params);
  inserted = result.rowCount ?? 0;

  return { inserted, duplicates: articles.length - inserted };
}

export async function getArticles(
  sinceDaysAgo: number = 3
): Promise<NormalizedArticle[]> {
  if (hasDb()) {
    return getArticlesDb(sinceDaysAgo);
  }

  const redis = getRedis();
  const since = Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000;
  const results = await redis.zrangebyscore(ARTICLES_KEY, since, "+inf");
  return results.map((item: string) => JSON.parse(item));
}

async function getArticlesDb(
  sinceDaysAgo: number
): Promise<NormalizedArticle[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000);

  const result = await db.query(
    `SELECT id, title, summary, url, image_url, published_at, source, source_country, category, keywords
     FROM articles
     WHERE published_at >= $1
     ORDER BY published_at DESC`,
    [since.toISOString()]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary || "",
    url: row.url,
    imageUrl: row.image_url,
    publishedAt: new Date(row.published_at).toISOString(),
    source: row.source,
    sourceCountry: row.source_country,
    category: row.category,
    keywords: row.keywords || [],
  }));
}

export async function getHourlyStats(
  hours: number = 48
): Promise<{ hour: string; count: number }[]> {
  if (hasDb()) {
    const db = getDb();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db.query(
      `SELECT date_trunc('hour', published_at) AS hour, COUNT(*)::int AS count
       FROM articles
       WHERE published_at >= $1
       GROUP BY hour
       ORDER BY hour ASC`,
      [since.toISOString()]
    );
    return result.rows.map((r) => ({
      hour: new Date(r.hour).toISOString(),
      count: r.count,
    }));
  }

  // Fallback: aggregate from Redis
  const redis = getRedis();
  const since = Date.now() - hours * 60 * 60 * 1000;
  const results = await redis.zrangebyscore(ARTICLES_KEY, since, "+inf");
  const buckets = new Map<string, number>();

  for (const item of results) {
    const article: NormalizedArticle = JSON.parse(item);
    const date = new Date(article.publishedAt);
    date.setMinutes(0, 0, 0);
    const key = date.toISOString();
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour, count }));
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

export async function ensureDbSchema(): Promise<void> {
  if (!hasDb()) return;
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      url TEXT UNIQUE NOT NULL,
      image_url TEXT,
      published_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL,
      source_country TEXT NOT NULL,
      category TEXT,
      keywords TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source)`);
}
