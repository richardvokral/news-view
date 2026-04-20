// Maps a Plausible site ID to a browsable base URL.
// Plausible site IDs are typically the domain (e.g. "echo24.cz") so the
// default is `https://<siteId>`. Override via env PLAUSIBLE_SITE_BASEURLS
// as a semicolon-separated list of `siteId=https://host` entries.

let cached: Map<string, string> | null = null;

function parse(): Map<string, string> {
  if (cached) return cached;
  const raw = process.env.PLAUSIBLE_SITE_BASEURLS || "";
  const map = new Map<string, string>();
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const id = trimmed.slice(0, eq).trim();
    const url = trimmed.slice(eq + 1).trim().replace(/\/+$/, "");
    if (id && url) map.set(id, url);
  }
  cached = map;
  return map;
}

export function siteBaseUrl(siteId: string): string {
  const override = parse().get(siteId);
  if (override) return override;
  return `https://${siteId}`;
}

export function articleUrl(siteId: string, pagePath: string): string {
  const base = siteBaseUrl(siteId);
  const path = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
  return `${base}${path}`;
}
