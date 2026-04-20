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
