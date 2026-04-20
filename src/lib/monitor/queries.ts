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

export async function listArticlesWithRecentStats(
  siteId: string | null,
  windowHours: number,
  snapshotLimit = 48,
  pagePaths?: string[]
): Promise<ArticleWithStats[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const params: unknown[] = [cutoff];
  let where = "first_seen_at >= $1";
  if (siteId) {
    params.push(siteId);
    where += ` AND site_id = $${params.length}`;
  }
  if (pagePaths && pagePaths.length > 0) {
    params.push(pagePaths);
    where += ` AND page_path = ANY($${params.length}::text[])`;
  }
  const { rows: articles } = await getDb().query<{
    page_path: string;
    site_id: string;
    first_seen_at: string;
    last_checked_at: string | null;
  }>(
    `SELECT page_path, site_id, first_seen_at, last_checked_at
       FROM article_monitors
      WHERE ${where}
      ORDER BY first_seen_at DESC
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
