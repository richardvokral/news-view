export const VALID_METRICS = new Set([
  "visitors",
  "visits",
  "pageviews",
  "views_per_visit",
  "bounce_rate",
  "visit_duration",
  "events",
]);

export const VALID_PERIODS = new Set([
  "day",
  "7d",
  "30d",
  "month",
  "6mo",
  "12mo",
  "custom",
]);

export const VALID_INTERVALS = new Set(["date", "month"]);

/** Ceiling for user-driven callers: the dashboard proxy and the Analyze tools. */
export const MAX_LIMIT = 100;

/**
 * Plausible's own hard ceiling on `limit` for `/api/v1/stats/breakdown`.
 * Internal callers only (the insights backfill) — `MAX_LIMIT` above is what a
 * request from a browser or from the model is allowed to ask for.
 */
export const PLAUSIBLE_MAX_BREAKDOWN_LIMIT = 1000;

export function validateMetrics(metrics: string): boolean {
  return metrics.split(",").every((m) => VALID_METRICS.has(m.trim()));
}
