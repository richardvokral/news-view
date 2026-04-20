// Trend KPI: visitors gained per minute over a recent window.
// Pure function so it can be used both in the dashboard memo pipeline
// and in tests. Uses a simple linear slope over points within the window.

interface TrendPoint {
  capturedAt: string;
  visitors: number | null;
}

export function computeTrendScore(
  snapshots: TrendPoint[],
  windowMinutes: number,
  now: number = Date.now()
): number {
  if (!snapshots || snapshots.length < 2 || windowMinutes <= 0) return 0;
  const cutoff = now - windowMinutes * 60_000;
  const pts: { t: number; v: number }[] = [];
  for (const s of snapshots) {
    const t = new Date(s.capturedAt).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const v = s.visitors ?? 0;
    pts.push({ t, v });
  }
  if (pts.length < 2) return 0;
  pts.sort((a, b) => a.t - b.t);
  // Least-squares slope (per minute).
  const n = pts.length;
  const mean = pts.reduce(
    (acc, p) => ({ t: acc.t + p.t, v: acc.v + p.v }),
    { t: 0, v: 0 }
  );
  const meanT = mean.t / n;
  const meanV = mean.v / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dt = p.t - meanT;
    num += dt * (p.v - meanV);
    den += dt * dt;
  }
  if (den === 0) return 0;
  const perMs = num / den;
  return perMs * 60_000;
}

export function formatTrendScore(score: number): string {
  if (!Number.isFinite(score) || Math.abs(score) < 0.05) return "0/m";
  const sign = score > 0 ? "+" : "";
  const abs = Math.abs(score);
  const rounded = abs >= 10 ? Math.round(score) : Math.round(score * 10) / 10;
  return `${sign}${rounded}/m`;
}

/**
 * First-hour growth KPI: visitor count recorded roughly one hour after the
 * article was first seen. Uses the snapshot with captured_at closest to
 * firstSeenAt + 60min (within a ±10min tolerance); falls back to the latest
 * snapshot within the first hour. Returns null when the article is less than
 * an hour old or has no snapshots inside that window.
 */
export function computeFirstHourGrowth(
  snapshots: TrendPoint[],
  firstSeenAt: string,
  now: number = Date.now()
): number | null {
  if (!snapshots || snapshots.length === 0) return null;
  const firstSeenMs = new Date(firstSeenAt).getTime();
  if (!Number.isFinite(firstSeenMs)) return null;
  const hourMark = firstSeenMs + 60 * 60_000;
  if (now < hourMark - 60_000) return null;

  const windowStart = firstSeenMs;
  const windowEnd = hourMark + 10 * 60_000;
  let best: { t: number; v: number; distance: number } | null = null;
  for (const s of snapshots) {
    const t = new Date(s.capturedAt).getTime();
    if (!Number.isFinite(t) || t < windowStart || t > windowEnd) continue;
    const v = s.visitors ?? 0;
    const distance = Math.abs(t - hourMark);
    if (!best || distance < best.distance) {
      best = { t, v, distance };
    }
  }
  return best ? best.v : null;
}
