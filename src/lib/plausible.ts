// Plausible API client. News-view supports multiple sites backed by the same
// API key (PLAUSIBLE_SITE_IDS is a semicolon-separated list).
//
// The key's rate limit (600 req/h by default) is therefore shared by every
// feature here — the monitor tick, the reports proxy and the insights
// backfill all draw on the same budget. See src/lib/insights/backfill.ts.

import { PLAUSIBLE_MAX_BREAKDOWN_LIMIT } from "./plausible-validate";

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

/**
 * Carries the status and body so callers can branch on *why* a call failed —
 * the insights backfill steps its metric set down on a 400 but aborts on
 * anything else. The message is unchanged from the original throw, so existing
 * catch-and-log sites behave exactly as before.
 */
export class PlausibleApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Plausible API error ${status}: ${body}`);
    this.name = "PlausibleApiError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function plausibleGet(
  path: string,
  siteId: string,
  params: QueryParams = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const url = new URL(`${getBaseUrl()}${path}`);
  url.searchParams.set("site_id", siteId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  // Without a timeout one hung upstream request can eat a whole serverless
  // invocation, which matters most for the multi-call backfill.
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new PlausibleApiError(res.status, text);
  }
  return res.json();
}

/**
 * Plausible's filter grammar uses `;` (AND), `|` (OR) and `*` (wildcard). A
 * value containing one of those silently changes what the query *means* rather
 * than erroring, so it returns wrong numbers instead of failing. Only `|` has
 * a documented escape, so callers should skip unsafe values, not escape them.
 */
export function isFilterSafeValue(value: string): boolean {
  return !/[;|*\\]/.test(value);
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
    page?: number;
  }
) {
  return plausibleGet("/api/v1/stats/breakdown", siteId, params);
}

export interface BreakdownRow {
  [key: string]: string | number;
}

/**
 * Page through a breakdown, for internal callers that need more than the
 * user-facing `MAX_LIMIT` of 100 rows.
 *
 * Kept separate from `getBreakdown` on purpose: the loop owns the page cap,
 * the dedupe and the per-call accounting, and keeping it out of the plain
 * helper means `/api/plausible` and the Analyze tools can never accidentally
 * inherit a paginating call. `MAX_LIMIT` keeps meaning "what a user may ask
 * for" and stays at 100.
 *
 * v1 has no row-count field, so the only stop signal is a short page. Row
 * order across pages is undocumented, so rows are deduped by `property` value
 * as they merge.
 */
export async function getBreakdownPaged(
  siteId: string,
  params: {
    property: string;
    metrics: string;
    period?: string;
    date?: string;
    filters?: string;
  },
  opts: {
    pageSize?: number;
    maxPages?: number;
    onPage?: (rows: BreakdownRow[], pageNo: number) => void;
    timeoutMs?: number;
  } = {}
): Promise<{ rows: BreakdownRow[]; pages: number; truncated: boolean }> {
  const pageSize = Math.min(
    Math.max(1, opts.pageSize ?? PLAUSIBLE_MAX_BREAKDOWN_LIMIT),
    PLAUSIBLE_MAX_BREAKDOWN_LIMIT
  );
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const dimension = params.property.split(":").pop() ?? "page";

  const seen = new Set<string>();
  const rows: BreakdownRow[] = [];
  let pages = 0;
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const raw = (await plausibleGet(
      "/api/v1/stats/breakdown",
      siteId,
      { ...params, limit: pageSize, page },
      opts.timeoutMs
    )) as { results?: BreakdownRow[] };
    pages += 1;

    const batch = Array.isArray(raw.results) ? raw.results : [];
    opts.onPage?.(batch, page);

    for (const row of batch) {
      const key = String(row[dimension] ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }

    // Short page means we reached the end.
    if (batch.length < pageSize) return { rows, pages, truncated: false };
    // A full page on the last allowed iteration means there was more.
    if (page === maxPages) truncated = true;
  }

  return { rows, pages, truncated };
}

export async function getRealtimeVisitors(siteId: string): Promise<number> {
  const result = await plausibleGet(
    "/api/v1/stats/realtime/visitors",
    siteId
  );
  return typeof result === "number" ? result : 0;
}

// Rolling window that spans at least `hours` of lookback (in calendar days,
// rounded up, plus today) so article-lifetime queries don't drop traffic
// from the earliest in-scope day when UTC midnight rolls over.
export function plausibleDayRange(
  hours: number = 48,
  now: Date = new Date()
): { period: "custom"; date: string } {
  const daysBack = Math.max(1, Math.ceil(hours / 24));
  const today = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const startDate = start.toISOString().slice(0, 10);
  return { period: "custom", date: `${startDate},${today}` };
}
