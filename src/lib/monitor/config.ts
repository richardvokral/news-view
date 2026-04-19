import { getDb, hasDb } from "@/lib/db";
import { DEFAULT_MONITOR_CONFIG, type MonitorConfig } from "@/types/dashboard";

interface DbRow {
  enabled: boolean;
  interval_seconds: number;
  window_hours: number;
  retention_days: number;
  max_requests_per_hour: number;
  site_patterns: Record<string, string> | null;
  updated_by: string | null;
  updated_at: string | Date | null;
}

function rowToConfig(r: DbRow): MonitorConfig {
  return {
    enabled: r.enabled,
    intervalSeconds: r.interval_seconds,
    windowHours: r.window_hours,
    retentionDays: r.retention_days,
    maxRequestsPerHour: r.max_requests_per_hour,
    sitePatterns: r.site_patterns ?? {},
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
            max_requests_per_hour, site_patterns, updated_by, updated_at
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
  };
  await getDb().query(
    `INSERT INTO monitor_config (id, enabled, interval_seconds, window_hours,
                                 retention_days, max_requests_per_hour,
                                 site_patterns, updated_by)
     VALUES (1, $1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       interval_seconds = EXCLUDED.interval_seconds,
       window_hours = EXCLUDED.window_hours,
       retention_days = EXCLUDED.retention_days,
       max_requests_per_hour = EXCLUDED.max_requests_per_hour,
       site_patterns = EXCLUDED.site_patterns,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      next.enabled,
      next.intervalSeconds,
      next.windowHours,
      next.retentionDays,
      next.maxRequestsPerHour,
      JSON.stringify(next.sitePatterns),
      email,
    ]
  );
}
