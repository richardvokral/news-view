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

export const MAX_LIMIT = 100;

export function validateMetrics(metrics: string): boolean {
  return metrics.split(",").every((m) => VALID_METRICS.has(m.trim()));
}
