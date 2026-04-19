// Plausible API client. News-view supports multiple sites backed by the same
// API key (PLAUSIBLE_SITE_IDS is a semicolon-separated list).

const getBaseUrl = () => {
  const url = process.env.PLAUSIBLE_API_URL;
  if (!url) throw new Error("PLAUSIBLE_API_URL is not configured");
  return url.replace(/\/$/, "");
};

const getApiKey = () => {
  const key = process.env.PLAUSIBLE_API_KEY;
  if (!key) throw new Error("PLAUSIBLE_API_KEY is not configured");
  return key;
};

export function listSiteIds(): string[] {
  return (process.env.PLAUSIBLE_SITE_IDS || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function defaultSiteId(): string | null {
  return listSiteIds()[0] ?? null;
}

export function isKnownSite(id: string): boolean {
  return listSiteIds().includes(id);
}

interface QueryParams {
  [key: string]: string | number | undefined;
}

async function plausibleGet(
  path: string,
  siteId: string,
  params: QueryParams = {}
): Promise<unknown> {
  const url = new URL(`${getBaseUrl()}${path}`);
  url.searchParams.set("site_id", siteId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plausible API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getAggregate(
  siteId: string,
  params: {
    metrics: string;
    period?: string;
    date?: string;
    filters?: string;
  }
) {
  return plausibleGet("/api/v1/stats/aggregate", siteId, params);
}

export async function getTimeseries(
  siteId: string,
  params: {
    metrics: string;
    period?: string;
    date?: string;
    filters?: string;
    interval?: string;
  }
) {
  return plausibleGet("/api/v1/stats/timeseries", siteId, params);
}

export async function getBreakdown(
  siteId: string,
  params: {
    property: string;
    metrics: string;
    period?: string;
    date?: string;
    filters?: string;
    limit?: number;
  }
) {
  return plausibleGet("/api/v1/stats/breakdown", siteId, params);
}

export async function getRealtimeVisitors(siteId: string): Promise<number> {
  const result = await plausibleGet(
    "/api/v1/stats/realtime/visitors",
    siteId
  );
  return typeof result === "number" ? result : 0;
}
