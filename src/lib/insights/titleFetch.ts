import { randomBytes } from "node:crypto";
import { getDb, hasDb } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { articleUrl } from "@/lib/monitor/site-urls";
import { articleRegexFor, getInsightsConfig } from "./store";

/**
 * Enriches stored articles with their real headline by reading og:title from
 * the site's own article pages.
 *
 * Why this exists: stored headlines are mostly reconstructed from URL slugs, so
 * they have lost diacritics, punctuation and capitalisation — exactly the
 * things a title analysis needs to see. This is the only way to get them back
 * for articles the monitor's RSS sync never covered.
 *
 * Same chunk/lock/cancel/deadline shape as the Plausible backfill.
 */
export const TITLE_FETCH_MAX_DURATION_S = 300;
const DEADLINE_MS = (TITLE_FETCH_MAX_DURATION_S - 60) * 1000;
const LOCK_TTL_S = TITLE_FETCH_MAX_DURATION_S + 30;

/** Politeness: it is our own site, but a backfill should still not hammer it. */
const CONCURRENCY = 4;
const BATCH_PAUSE_MS = 250;
const REQUEST_TIMEOUT_MS = 8_000;
/**
 * og:title always lives in the head. Article pages run 300-800 KB, so reading
 * whole bodies would pull well over a gigabyte per run for data we discard.
 */
const MAX_BYTES = 64 * 1024;
const USER_AGENT = "news-view-insights/1.0 (+internal title enrichment)";

const lockKey = (siteId: string) => `insights:titlefetch:lock:${siteId}`;
const cancelKey = (runKey: string) => `insights:titlefetch:cancel:${runKey}`;

export type TitleFetchStatus = "ok" | "notfound" | "redirected" | "error";

export interface TitleFetchResult {
  ok: boolean;
  runKey: string;
  siteId: string;
  processed: number;
  updated: number;
  failed: number;
  remaining: number;
  skippedReason?: "locked" | "redis_unavailable" | "cancelled" | "not_configured";
  error?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * og:title first, then twitter:title, then <title>. Attribute order varies, so
 * the property and the content are matched independently within one tag.
 */
export function extractTitle(html: string): string | null {
  const head = html.slice(0, 200_000);

  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  const metas: { key: string; content: string }[] = [];
  while ((match = metaRe.exec(head)) !== null) {
    const tag = match[0];
    const key =
      /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ??
      "";
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (key && content) metas.push({ key, content });
  }
  for (const wanted of ["og:title", "twitter:title"]) {
    const hit = metas.find((m) => m.key === wanted);
    if (hit) {
      const value = decodeEntities(hit.content).trim();
      if (value) return value;
    }
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (titleTag) {
    const value = decodeEntities(titleTag[1]).replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return null;
}

/** Strips a trailing site-name suffix such as " | Echo24" when configured. */
export function stripSuffixes(title: string, suffixes: string[]): string {
  let out = title.trim();
  for (const suffix of suffixes) {
    const s = suffix.trim();
    if (!s) continue;
    if (out.toLowerCase().endsWith(s.toLowerCase())) {
      out = out.slice(0, out.length - s.length).trim();
      // A dangling separator is left behind once the name is gone.
      out = out.replace(/[\s]*[|–—\-·:]+$/, "").trim();
    }
  }
  return out;
}

interface PendingRow {
  pagePath: string;
}

/**
 * Only pages that have no real title yet. Deliberately never touches a page
 * whose title came from RSS: that one is already correct, and re-fetching it
 * risks replacing a good headline with a paywall or redirect artefact.
 */
async function listPending(siteId: string, limit: number): Promise<PendingRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<{ page_path: string }>(
    `SELECT page_path FROM insights_pages
      WHERE site_id = $1
        AND headline_source = 'slug'
        AND title_fetched_at IS NULL
      ORDER BY last_week DESC NULLS LAST
      LIMIT $2`,
    [siteId, limit]
  );
  return rows.map((r) => ({ pagePath: r.page_path }));
}

async function countPending(siteId: string): Promise<number> {
  if (!hasDb()) return 0;
  const { rows } = await getDb().query<{ n: string }>(
    `SELECT COUNT(*)::bigint AS n FROM insights_pages
      WHERE site_id = $1 AND headline_source = 'slug' AND title_fetched_at IS NULL`,
    [siteId]
  );
  return rows.length ? Number(rows[0].n) : 0;
}

async function recordResult(
  siteId: string,
  pagePath: string,
  status: TitleFetchStatus,
  title: string | null
): Promise<boolean> {
  if (!hasDb()) return false;
  if (status === "ok" && title) {
    const res = await getDb().query(
      `UPDATE insights_pages
          SET title = $3, headline_source = 'page',
              title_fetched_at = NOW(), title_fetch_status = 'ok',
              updated_at = NOW()
        WHERE site_id = $1 AND page_path = $2
          AND headline_source = 'slug'`,
      [siteId, pagePath, title]
    );
    return (res.rowCount ?? 0) > 0;
  }
  await getDb().query(
    `UPDATE insights_pages
        SET title_fetched_at = NOW(), title_fetch_status = $3, updated_at = NOW()
      WHERE site_id = $1 AND page_path = $2`,
    [siteId, pagePath, status]
  );
  return false;
}

/** Reads only as far as `</head>` or the byte cap, whichever comes first. */
async function readHead(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (out.includes("</head>") || bytes >= MAX_BYTES) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out;
}

/**
 * The short id is the article's identity; the slug can legitimately change.
 * Comparing ids catches the dangerous case — a redirect to the homepage or a
 * section page returns HTTP 200 with a perfectly good og:title, which is the
 * *section's* title. Storing those would poison the corpus with the same
 * headline repeated hundreds of times.
 */
function sameArticle(
  requested: string,
  finalPath: string,
  articleRegex: RegExp
): boolean {
  const a = articleRegex.exec(requested)?.[1];
  const b = articleRegex.exec(finalPath)?.[1];
  if (a && b) return a === b;
  return finalPath.replace(/\/+$/, "") === requested.replace(/\/+$/, "");
}

async function fetchOne(
  siteId: string,
  pagePath: string,
  suffixes: string[],
  articleRegex: RegExp
): Promise<{ status: TitleFetchStatus; title: string | null }> {
  const url = articleUrl(siteId, pagePath);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "cs,sk;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: "error", title: null };
  }

  if (res.status === 404 || res.status === 410) {
    return { status: "notfound", title: null };
  }
  // A paywalled page usually still serves og:title for crawlers and social
  // cards, so parse the body before giving up on 401/403/429.
  const paywalled = res.status === 401 || res.status === 403 || res.status === 429;
  if (!res.ok && !paywalled) return { status: "error", title: null };

  try {
    const final = new URL(res.url);
    if (!sameArticle(pagePath, final.pathname, articleRegex)) {
      return { status: "redirected", title: null };
    }
  } catch {
    // Unparseable final URL: fall through and judge by content.
  }

  let html: string;
  try {
    html = await readHead(res);
  } catch {
    return { status: "error", title: null };
  }

  const raw = extractTitle(html);
  if (!raw) return { status: paywalled ? "error" : "notfound", title: null };
  const title = stripSuffixes(raw, suffixes);
  if (!acceptTitle(title)) return { status: "error", title: null };
  return { status: "ok", title };
}

/**
 * Quality gate, separate from precedence. The diacritics rule is the one that
 * matters here: a multi-word Czech "title" with no diacritics at all is almost
 * certainly a slug echo or a fallback page, and it adds nothing over the
 * de-slugified headline we already have.
 */
export function acceptTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 10) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (/^(404|chyba|str[aá]nka nenalezena|p[řr][ií]stup odep[řr]en)/i.test(t)) {
    return false;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 4 && !/[áčďéěíňóřšťúůýž]/i.test(t)) return false;
  return true;
}

export async function cancelTitleFetch(runKey: string): Promise<void> {
  try {
    await getRedis().set(cancelKey(runKey), "1", "EX", LOCK_TTL_S);
  } catch {
    // The run finishes its current batch either way.
  }
}

export async function runTitleFetch(
  siteId: string,
  opts: { limit?: number; runKey?: string } = {}
): Promise<TitleFetchResult> {
  const runKey = opts.runKey || randomBytes(8).toString("hex");
  const base: TitleFetchResult = {
    ok: true,
    runKey,
    siteId,
    processed: 0,
    updated: 0,
    failed: 0,
    remaining: 0,
  };
  if (!hasDb()) return { ...base, ok: false, skippedReason: "not_configured" };

  const config = await getInsightsConfig();
  const redis = getRedis();

  // Fails closed, like the Plausible backfill: two concurrent runs would
  // double the load on the site for no benefit.
  let acquired: string | null;
  try {
    acquired = await redis.set(lockKey(siteId), runKey, "EX", LOCK_TTL_S, "NX");
  } catch {
    return { ...base, ok: false, skippedReason: "redis_unavailable" };
  }
  if (!acquired) return { ...base, ok: false, skippedReason: "locked" };

  const t0 = Date.now();
  let processed = 0;
  let updated = 0;
  let failed = 0;

  try {
    const limit = Math.min(
      Math.max(1, opts.limit ?? config.titleFetchPerRun),
      1000
    );
    const pending = await listPending(siteId, limit);
    const suffixes = config.titleStripSuffixes;
    const articleRegex = articleRegexFor(config);

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      if (Date.now() - t0 > DEADLINE_MS) break;
      try {
        if (await redis.get(cancelKey(runKey))) {
          return {
            ...base,
            ok: false,
            skippedReason: "cancelled",
            processed,
            updated,
            failed,
            remaining: await countPending(siteId),
          };
        }
      } catch {
        // A Redis hiccup shouldn't abort an in-flight run.
      }

      const batch = pending.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((row) =>
          fetchOne(siteId, row.pagePath, suffixes, articleRegex)
        )
      );
      for (let j = 0; j < batch.length; j += 1) {
        const r = results[j];
        const wrote = await recordResult(
          siteId,
          batch[j].pagePath,
          r.status,
          r.title
        );
        processed += 1;
        if (wrote) updated += 1;
        else if (r.status !== "ok") failed += 1;
      }

      if (i + CONCURRENCY < pending.length) {
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
    }

    return {
      ...base,
      ok: true,
      processed,
      updated,
      failed,
      remaining: await countPending(siteId),
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      processed,
      updated,
      failed,
      remaining: await countPending(siteId).catch(() => 0),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        lockKey(siteId),
        runKey
      );
    } catch {
      // Lock expires on its own.
    }
  }
}

export async function getTitleCoverage(
  siteId: string
): Promise<{ total: number; real: number; slug: number; failed: number }> {
  if (!hasDb()) return { total: 0, real: 0, slug: 0, failed: 0 };
  const { rows } = await getDb().query(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE headline_source <> 'slug')::bigint AS real,
            COUNT(*) FILTER (WHERE headline_source = 'slug')::bigint AS slug,
            COUNT(*) FILTER (WHERE title_fetch_status IN ('error','notfound','redirected'))::bigint AS failed
       FROM insights_pages WHERE site_id = $1`,
    [siteId]
  );
  const r = rows[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    real: Number(r.real ?? 0),
    slug: Number(r.slug ?? 0),
    failed: Number(r.failed ?? 0),
  };
}
