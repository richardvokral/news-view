import { getDb, hasDb } from "@/lib/db";
import { DEFAULT_MONITOR_CONFIG, type MonitorConfig } from "@/types/dashboard";

interface DbRow {
  enabled: boolean;
  interval_seconds: number;
  window_hours: number;
  retention_days: number;
  max_requests_per_hour: number;
  site_patterns: Record<string, string> | null;
  source_sampling_enabled: boolean | null;
  source_sampling_top_n: number | null;
  trend_window_minutes: number | null;
  source_timeseries_enabled: boolean | null;
  excluded_sources: string[] | null;
  rss_enabled: boolean | null;
  site_rss_urls: Record<string, string> | null;
  show_article_images: boolean | null;
  author_short_names: Record<string, string> | null;
  updated_by: string | null;
  updated_at: string | Date | null;
}

function normalizeStringMap(
  value: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== "string") continue;
    const key = k.trim();
    if (!key) continue;
    if (typeof v !== "string") continue;
    const val = v.trim();
    if (!val) continue;
    out[key] = val;
  }
  return out;
}

function rowToConfig(r: DbRow): MonitorConfig {
  return {
    enabled: r.enabled,
    intervalSeconds: r.interval_seconds,
    windowHours: r.window_hours,
    retentionDays: r.retention_days,
    maxRequestsPerHour: r.max_requests_per_hour,
    sitePatterns: r.site_patterns ?? {},
    sourceSamplingEnabled:
      r.source_sampling_enabled ?? DEFAULT_MONITOR_CONFIG.sourceSamplingEnabled,
    sourceSamplingTopN:
      r.source_sampling_top_n ?? DEFAULT_MONITOR_CONFIG.sourceSamplingTopN,
    trendWindowMinutes:
      r.trend_window_minutes ?? DEFAULT_MONITOR_CONFIG.trendWindowMinutes,
    sourceTimeseriesEnabled:
      r.source_timeseries_enabled ??
      DEFAULT_MONITOR_CONFIG.sourceTimeseriesEnabled,
    excludedSources: Array.isArray(r.excluded_sources)
      ? r.excluded_sources.map(String)
      : [],
    rssEnabled: r.rss_enabled ?? DEFAULT_MONITOR_CONFIG.rssEnabled,
    siteRssUrls: normalizeStringMap(r.site_rss_urls),
    showArticleImages:
      r.show_article_images ?? DEFAULT_MONITOR_CONFIG.showArticleImages,
    authorShortNames: normalizeStringMap(r.author_short_names),
    updatedBy: r.updated_by,
    updatedAt: r.updated_at
      ? new Date(r.updated_at as string).toISOString()
      : null,
  };
}

export async function getMonitorConfig(): Promise<MonitorConfig> {
  if (!hasDb()) return { ...DEFAULT_MONITOR_CONFIG };
  const { rows } = await getDb().query<DbRow>(
    `SELECT enabled, interval_seconds, window_hours, retention_days,
            max_requests_per_hour, site_patterns,
            source_sampling_enabled, source_sampling_top_n, trend_window_minutes,
            source_timeseries_enabled, excluded_sources,
            rss_enabled, site_rss_urls, show_article_images, author_short_names,
            updated_by, updated_at
       FROM monitor_config WHERE id = 1`
  );
  return rows.length ? rowToConfig(rows[0]) : { ...DEFAULT_MONITOR_CONFIG };
}

export async function saveMonitorConfig(
  email: string,
  cfg: Partial<MonitorConfig>
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const current = await getMonitorConfig();
  const next: MonitorConfig = {
    ...current,
    ...cfg,
    intervalSeconds: Math.max(60, cfg.intervalSeconds ?? current.intervalSeconds),
    windowHours: Math.max(1, cfg.windowHours ?? current.windowHours),
    retentionDays: Math.max(1, cfg.retentionDays ?? current.retentionDays),
    maxRequestsPerHour: Math.max(
      1,
      cfg.maxRequestsPerHour ?? current.maxRequestsPerHour
    ),
    sitePatterns: cfg.sitePatterns ?? current.sitePatterns,
    enabled: cfg.enabled ?? current.enabled,
    sourceSamplingEnabled:
      cfg.sourceSamplingEnabled ?? current.sourceSamplingEnabled,
    sourceSamplingTopN: Math.max(
      1,
      Math.min(50, cfg.sourceSamplingTopN ?? current.sourceSamplingTopN)
    ),
    trendWindowMinutes: Math.max(
      5,
      Math.min(1440, cfg.trendWindowMinutes ?? current.trendWindowMinutes)
    ),
    sourceTimeseriesEnabled:
      cfg.sourceTimeseriesEnabled ?? current.sourceTimeseriesEnabled,
    excludedSources: Array.isArray(cfg.excludedSources)
      ? Array.from(
          new Set(
            cfg.excludedSources.map((s) => String(s).trim()).filter(Boolean)
          )
        )
      : current.excludedSources,
    rssEnabled: cfg.rssEnabled ?? current.rssEnabled,
    siteRssUrls: cfg.siteRssUrls
      ? normalizeStringMap(cfg.siteRssUrls)
      : current.siteRssUrls,
    showArticleImages: cfg.showArticleImages ?? current.showArticleImages,
    authorShortNames: cfg.authorShortNames
      ? normalizeStringMap(cfg.authorShortNames)
      : current.authorShortNames,
  };
  await getDb().query(
    `INSERT INTO monitor_config (id, enabled, interval_seconds, window_hours,
                                 retention_days, max_requests_per_hour,
                                 site_patterns,
                                 source_sampling_enabled, source_sampling_top_n,
                                 trend_window_minutes,
                                 source_timeseries_enabled, excluded_sources,
                                 rss_enabled, site_rss_urls,
                                 show_article_images, author_short_names,
                                 updated_by)
     VALUES (1, $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb,
             $12, $13::jsonb, $14, $15::jsonb, $16)
     ON CONFLICT (id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       interval_seconds = EXCLUDED.interval_seconds,
       window_hours = EXCLUDED.window_hours,
       retention_days = EXCLUDED.retention_days,
       max_requests_per_hour = EXCLUDED.max_requests_per_hour,
       site_patterns = EXCLUDED.site_patterns,
       source_sampling_enabled = EXCLUDED.source_sampling_enabled,
       source_sampling_top_n = EXCLUDED.source_sampling_top_n,
       trend_window_minutes = EXCLUDED.trend_window_minutes,
       source_timeseries_enabled = EXCLUDED.source_timeseries_enabled,
       excluded_sources = EXCLUDED.excluded_sources,
       rss_enabled = EXCLUDED.rss_enabled,
       site_rss_urls = EXCLUDED.site_rss_urls,
       show_article_images = EXCLUDED.show_article_images,
       author_short_names = EXCLUDED.author_short_names,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      next.enabled,
      next.intervalSeconds,
      next.windowHours,
      next.retentionDays,
      next.maxRequestsPerHour,
      JSON.stringify(next.sitePatterns),
      next.sourceSamplingEnabled,
      next.sourceSamplingTopN,
      next.trendWindowMinutes,
      next.sourceTimeseriesEnabled,
      JSON.stringify(next.excludedSources),
      next.rssEnabled,
      JSON.stringify(next.siteRssUrls),
      next.showArticleImages,
      JSON.stringify(next.authorShortNames),
      email,
    ]
  );
}
