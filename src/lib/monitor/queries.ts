import { getDb, hasDb } from "@/lib/db";

export interface ArticleRow {
  pagePath: string;
  siteId: string;
  firstSeenAt: string;
  lastCheckedAt: string | null;
}

export interface SnapshotRow {
  capturedAt: string;
  windowSeconds: number;
  visitors: number | null;
  pageviews: number | null;
}

export interface ArticleWithStats {
  pagePath: string;
  siteId: string;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  currentVisitors: number;
  currentPageviews: number;
  snapshots: SnapshotRow[];
  title: string | null;
  imageUrl: string | null;
  titleUpdatedAt: string | null;
}

export interface TitleHistoryRow {
  capturedAt: string;
  title: string;
  imageUrl: string | null;
}

export interface SourceVisitorRow {
  source: string;
  visitors: number;
}

export interface SourceTimeseriesPoint {
  capturedAt: string;
  source: string;
  visitors: number;
}

export async function upsertArticle(
  pagePath: string,
  siteId: string,
  now: Date
): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO article_monitors (page_path, site_id, last_checked_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (page_path) DO UPDATE
       SET last_checked_at = EXCLUDED.last_checked_at`,
    [pagePath, siteId, now]
  );
}

export async function insertSnapshot(
  pagePath: string,
  capturedAt: Date,
  windowSeconds: number,
  visitors: number,
  pageviews: number
): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO article_metric_snapshots (page_path, captured_at, window_seconds, visitors, pageviews)
     VALUES ($1, $2, $3, $4, $5)`,
    [pagePath, capturedAt, windowSeconds, visitors, pageviews]
  );
}

export async function insertArticleSourceSnapshot(
  pagePath: string,
  capturedAt: Date,
  source: string,
  visitors: number
): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO article_source_snapshots (page_path, captured_at, source, visitors)
     VALUES ($1, $2, $3, $4)`,
    [pagePath, capturedAt, source, visitors]
  );
}

/**
 * Record an observed title for an article. The caller is responsible for
 * only calling this when the title has actually changed (or there is no
 * prior title row) to keep the table append-only and meaningful.
 */
export async function insertArticleTitle(
  pagePath: string,
  siteId: string,
  capturedAt: Date,
  title: string,
  imageUrl: string | null
): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO article_titles (page_path, site_id, captured_at, title, image_url)
     VALUES ($1, $2, $3, $4, $5)`,
    [pagePath, siteId, capturedAt, title, imageUrl]
  );
}

export async function getLatestTitle(
  pagePath: string
): Promise<{ title: string; imageUrl: string | null; capturedAt: string } | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{
    title: string;
    image_url: string | null;
    captured_at: string;
  }>(
    `SELECT title, image_url, captured_at
       FROM article_titles
      WHERE page_path = $1
      ORDER BY captured_at DESC
      LIMIT 1`,
    [pagePath]
  );
  if (rows.length === 0) return null;
  return {
    title: rows[0].title,
    imageUrl: rows[0].image_url,
    capturedAt: rows[0].captured_at,
  };
}

export async function listTitleHistoryForArticle(
  pagePath: string
): Promise<TitleHistoryRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<{
    captured_at: string;
    title: string;
    image_url: string | null;
  }>(
    `SELECT captured_at, title, image_url
       FROM article_titles
      WHERE page_path = $1
      ORDER BY captured_at ASC`,
    [pagePath]
  );
  return rows.map((r) => ({
    capturedAt: r.captured_at,
    title: r.title,
    imageUrl: r.image_url,
  }));
}

export async function listArticlesWithRecentStats(
  siteId: string | null,
  windowHours: number,
  snapshotLimit = 48,
  pagePaths?: string[]
): Promise<ArticleWithStats[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const params: unknown[] = [cutoff];
  let where = "m.first_seen_at >= $1";
  if (siteId) {
    params.push(siteId);
    where += ` AND m.site_id = $${params.length}`;
  }
  if (pagePaths && pagePaths.length > 0) {
    params.push(pagePaths);
    where += ` AND m.page_path = ANY($${params.length}::text[])`;
  }
  const { rows: articles } = await getDb().query<{
    page_path: string;
    site_id: string;
    first_seen_at: string;
    last_checked_at: string | null;
    title: string | null;
    image_url: string | null;
    title_updated_at: string | null;
  }>(
    `SELECT m.page_path, m.site_id, m.first_seen_at, m.last_checked_at,
            t.title, t.image_url, t.captured_at AS title_updated_at
       FROM article_monitors m
       LEFT JOIN LATERAL (
         SELECT title, image_url, captured_at
           FROM article_titles
          WHERE page_path = m.page_path
          ORDER BY captured_at DESC
          LIMIT 1
       ) t ON true
      WHERE ${where}
      ORDER BY m.first_seen_at DESC
      LIMIT 200`,
    params
  );
  if (articles.length === 0) return [];

  const paths = articles.map((a) => a.page_path);
  const { rows: snaps } = await getDb().query<{
    page_path: string;
    captured_at: string;
    window_seconds: number;
    visitors: number | null;
    pageviews: number | null;
  }>(
    `SELECT page_path, captured_at, window_seconds, visitors, pageviews
       FROM article_metric_snapshots
      WHERE page_path = ANY($1::text[])
      ORDER BY captured_at DESC
      LIMIT $2`,
    [paths, paths.length * snapshotLimit]
  );

  const byPath = new Map<string, SnapshotRow[]>();
  for (const r of snaps) {
    const arr = byPath.get(r.page_path) ?? [];
    if (arr.length < snapshotLimit) {
      arr.push({
        capturedAt: r.captured_at,
        windowSeconds: r.window_seconds,
        visitors: r.visitors,
        pageviews: r.pageviews,
      });
      byPath.set(r.page_path, arr);
    }
  }

  return articles.map((a) => {
    const snapshots = (byPath.get(a.page_path) ?? []).slice().reverse();
    const latest = snapshots[snapshots.length - 1];
    return {
      pagePath: a.page_path,
      siteId: a.site_id,
      firstSeenAt: a.first_seen_at,
      lastCheckedAt: a.last_checked_at,
      currentVisitors: latest?.visitors ?? 0,
      currentPageviews: latest?.pageviews ?? 0,
      snapshots,
      title: a.title,
      imageUrl: a.image_url,
      titleUpdatedAt: a.title_updated_at,
    };
  });
}

/**
 * Most recent visitors-per-source for a given article, using the latest
 * captured_at per source within the window.
 */
export async function listLatestSourcesForArticle(
  pagePath: string,
  windowHours: number,
  limit = 10
): Promise<SourceVisitorRow[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const { rows } = await getDb().query<{
    source: string;
    visitors: number;
  }>(
    `SELECT DISTINCT ON (source) source, visitors
       FROM article_source_snapshots
      WHERE page_path = $1 AND captured_at >= $2
      ORDER BY source, captured_at DESC`,
    [pagePath, cutoff]
  );
  return rows
    .map((r) => ({ source: r.source, visitors: Number(r.visitors) || 0 }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, limit);
}

export async function listSourceTimeseriesForArticle(
  pagePath: string,
  windowHours: number
): Promise<SourceTimeseriesPoint[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const { rows } = await getDb().query<{
    captured_at: string;
    source: string;
    visitors: number;
  }>(
    `SELECT captured_at, source, visitors
       FROM article_source_snapshots
      WHERE page_path = $1 AND captured_at >= $2
      ORDER BY captured_at ASC`,
    [pagePath, cutoff]
  );
  return rows.map((r) => ({
    capturedAt: r.captured_at,
    source: r.source,
    visitors: Number(r.visitors) || 0,
  }));
}

export async function pruneSnapshots(retentionDays: number): Promise<number> {
  if (!hasDb()) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const result = await getDb().query(
    `DELETE FROM article_metric_snapshots WHERE captured_at < $1`,
    [cutoff]
  );
  return result.rowCount ?? 0;
}

export async function pruneArticleSourceSnapshots(
  retentionDays: number
): Promise<number> {
  if (!hasDb()) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const result = await getDb().query(
    `DELETE FROM article_source_snapshots WHERE captured_at < $1`,
    [cutoff]
  );
  return result.rowCount ?? 0;
}

export async function pruneMonitors(windowHours: number): Promise<number> {
  if (!hasDb()) return 0;
  // Keep the monitor row 24h past the window so the dashboard can still
  // render recent history; then drop.
  const cutoff = new Date(Date.now() - (windowHours + 24) * 3600 * 1000);
  const result = await getDb().query(
    `DELETE FROM article_monitors
      WHERE COALESCE(last_checked_at, first_seen_at) < $1`,
    [cutoff]
  );
  return result.rowCount ?? 0;
}
