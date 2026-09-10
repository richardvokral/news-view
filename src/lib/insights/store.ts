import { getDb, hasDb } from "@/lib/db";
import {
  DEFAULT_INSIGHTS_CONFIG,
  type AggregatedArticle,
  type InsightRunResult,
  type InsightRunRow,
  type InsightsConfig,
  type MetricTier,
  type PageWeekRow,
  type WeekLedgerRow,
  type AnalysisScope,
} from "./types";
import { parseArticlePath, buildArticleRegex } from "./paths";

// Postgres returns NUMERIC/BIGINT as strings through the Neon driver.
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}
function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

// --- Config -----------------------------------------------------------------

interface ConfigRow {
  backfill_weeks: number;
  weeks_per_request: number;
  page_limit: number;
  max_pages_per_week: number;
  max_requests_per_run: number;
  refetch_grace_hours: number;
  article_path_filter: string;
  article_path_regex: string;
  section_vocabulary: unknown;
  ai_model_key: string | null;
  ai_top_articles: number;
  title_fetch_per_run: number;
  title_tail_weeks: number;
  title_min_pageviews: number;
  title_strip_suffixes: unknown;
  updated_by: string | null;
  updated_at: unknown;
}

function normalizeVocabulary(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return [...seen].sort();
}

export async function getInsightsConfig(): Promise<InsightsConfig> {
  if (!hasDb()) return { ...DEFAULT_INSIGHTS_CONFIG };
  const { rows } = await getDb().query<ConfigRow>(
    `SELECT backfill_weeks, weeks_per_request, page_limit, max_pages_per_week,
            max_requests_per_run, refetch_grace_hours, article_path_filter,
            article_path_regex, section_vocabulary, ai_model_key,
            ai_top_articles, title_fetch_per_run, title_strip_suffixes,
            title_tail_weeks, title_min_pageviews, updated_by, updated_at
       FROM insights_config WHERE id = 1`
  );
  if (rows.length === 0) return { ...DEFAULT_INSIGHTS_CONFIG };
  const r = rows[0];
  return {
    backfillWeeks: num(r.backfill_weeks) || DEFAULT_INSIGHTS_CONFIG.backfillWeeks,
    weeksPerRequest:
      num(r.weeks_per_request) || DEFAULT_INSIGHTS_CONFIG.weeksPerRequest,
    pageLimit: num(r.page_limit) || DEFAULT_INSIGHTS_CONFIG.pageLimit,
    maxPagesPerWeek:
      num(r.max_pages_per_week) || DEFAULT_INSIGHTS_CONFIG.maxPagesPerWeek,
    maxRequestsPerRun:
      num(r.max_requests_per_run) || DEFAULT_INSIGHTS_CONFIG.maxRequestsPerRun,
    refetchGraceHours:
      num(r.refetch_grace_hours) || DEFAULT_INSIGHTS_CONFIG.refetchGraceHours,
    articlePathFilter: r.article_path_filter ?? "",
    articlePathRegex: r.article_path_regex ?? "",
    sectionVocabulary: normalizeVocabulary(r.section_vocabulary),
    aiModelKey: r.ai_model_key,
    aiTopArticles:
      num(r.ai_top_articles) || DEFAULT_INSIGHTS_CONFIG.aiTopArticles,
    titleFetchPerRun:
      num(r.title_fetch_per_run) || DEFAULT_INSIGHTS_CONFIG.titleFetchPerRun,
    titleTailWeeks: Number.isFinite(Number(r.title_tail_weeks))
      ? Number(r.title_tail_weeks)
      : DEFAULT_INSIGHTS_CONFIG.titleTailWeeks,
    titleMinPageviews:
      num(r.title_min_pageviews) || DEFAULT_INSIGHTS_CONFIG.titleMinPageviews,
    titleStripSuffixes: Array.isArray(r.title_strip_suffixes)
      ? (r.title_strip_suffixes as unknown[]).filter(
          (v): v is string => typeof v === "string"
        )
      : [],
    updatedBy: r.updated_by,
    updatedAt: r.updated_at ? iso(r.updated_at) : null,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export async function saveInsightsConfig(
  email: string,
  patch: Partial<InsightsConfig>
): Promise<InsightsConfig> {
  if (!hasDb()) throw new Error("Database not configured");
  const current = await getInsightsConfig();
  const next: InsightsConfig = { ...current, ...patch };

  // Clamps mirror monitor_config: the UI adopts whatever comes back, so a
  // silly value shows up corrected rather than being silently honoured.
  const backfillWeeks = clamp(next.backfillWeeks, 1, 260);
  const weeksPerRequest = clamp(next.weeksPerRequest, 1, 8);
  const pageLimit = clamp(next.pageLimit, 100, 1000);
  const maxPagesPerWeek = clamp(next.maxPagesPerWeek, 1, 50);
  const maxRequestsPerRun = clamp(next.maxRequestsPerRun, 1, 600);
  const refetchGraceHours = clamp(next.refetchGraceHours, 0, 336);
  const aiTopArticles = clamp(next.aiTopArticles, 20, 600);
  const titleFetchPerRun = clamp(next.titleFetchPerRun, 10, 1000);
  const titleTailWeeks = clamp(next.titleTailWeeks, 0, 4);
  const titleMinPageviews = clamp(next.titleMinPageviews, 1, 10000);

  await getDb().query(
    `INSERT INTO insights_config
       (id, backfill_weeks, weeks_per_request, page_limit, max_pages_per_week,
        max_requests_per_run, refetch_grace_hours, article_path_filter,
        article_path_regex, section_vocabulary, ai_model_key, ai_top_articles,
        title_fetch_per_run, title_strip_suffixes, title_tail_weeks,
        title_min_pageviews, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
             $13::jsonb, $14, $15, $16, NOW())
     ON CONFLICT (id) DO UPDATE SET
       backfill_weeks = EXCLUDED.backfill_weeks,
       weeks_per_request = EXCLUDED.weeks_per_request,
       page_limit = EXCLUDED.page_limit,
       max_pages_per_week = EXCLUDED.max_pages_per_week,
       max_requests_per_run = EXCLUDED.max_requests_per_run,
       refetch_grace_hours = EXCLUDED.refetch_grace_hours,
       article_path_filter = EXCLUDED.article_path_filter,
       article_path_regex = EXCLUDED.article_path_regex,
       section_vocabulary = EXCLUDED.section_vocabulary,
       ai_model_key = EXCLUDED.ai_model_key,
       ai_top_articles = EXCLUDED.ai_top_articles,
       title_fetch_per_run = EXCLUDED.title_fetch_per_run,
       title_strip_suffixes = EXCLUDED.title_strip_suffixes,
       title_tail_weeks = EXCLUDED.title_tail_weeks,
       title_min_pageviews = EXCLUDED.title_min_pageviews,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      backfillWeeks,
      weeksPerRequest,
      pageLimit,
      maxPagesPerWeek,
      maxRequestsPerRun,
      refetchGraceHours,
      next.articlePathFilter.trim(),
      next.articlePathRegex.trim(),
      JSON.stringify(normalizeVocabulary(next.sectionVocabulary)),
      next.aiModelKey,
      aiTopArticles,
      titleFetchPerRun,
      JSON.stringify(
        next.titleStripSuffixes.map((v) => v.trim()).filter(Boolean)
      ),
      titleTailWeeks,
      titleMinPageviews,
      email,
    ]
  );
  return getInsightsConfig();
}

// --- Week ledger ------------------------------------------------------------

interface LedgerRow {
  site_id: string;
  week_start: unknown;
  week_end: unknown;
  status: string;
  is_partial: boolean;
  truncated: boolean;
  metrics_tier: number | null;
  rows_written: number;
  api_calls: number;
  error: string | null;
  fetched_at: unknown;
}

function rowToLedger(r: LedgerRow): WeekLedgerRow {
  return {
    siteId: r.site_id,
    weekStart: dateOnly(r.week_start),
    weekEnd: dateOnly(r.week_end),
    status: (r.status as WeekLedgerRow["status"]) ?? "pending",
    isPartial: !!r.is_partial,
    truncated: !!r.truncated,
    metricsTier: (numOrNull(r.metrics_tier) as MetricTier | null) ?? null,
    rowsWritten: num(r.rows_written),
    apiCalls: num(r.api_calls),
    error: r.error,
    fetchedAt: r.fetched_at ? iso(r.fetched_at) : null,
  };
}

export async function listWeekLedger(siteId: string): Promise<WeekLedgerRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<LedgerRow>(
    `SELECT site_id, week_start, week_end, status, is_partial, truncated,
            metrics_tier, rows_written, api_calls, error, fetched_at
       FROM insights_backfill_weeks
      WHERE site_id = $1
      ORDER BY week_start DESC`,
    [siteId]
  );
  return rows.map(rowToLedger);
}

export async function upsertWeekLedger(
  row: Omit<WeekLedgerRow, "fetchedAt">
): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO insights_backfill_weeks
       (site_id, week_start, week_end, status, is_partial, truncated,
        metrics_tier, rows_written, api_calls, error, fetched_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (site_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end,
       status = EXCLUDED.status,
       is_partial = EXCLUDED.is_partial,
       truncated = EXCLUDED.truncated,
       metrics_tier = EXCLUDED.metrics_tier,
       rows_written = EXCLUDED.rows_written,
       api_calls = EXCLUDED.api_calls,
       error = EXCLUDED.error,
       fetched_at = NOW(),
       updated_at = NOW()`,
    [
      row.siteId,
      row.weekStart,
      row.weekEnd,
      row.status,
      row.isPartial,
      row.truncated,
      row.metricsTier,
      row.rowsWritten,
      row.apiCalls,
      row.error,
    ]
  );
}

// --- Facts ------------------------------------------------------------------

/**
 * Write one week of rows. A week is committed as a unit: the caller collects
 * every page first and calls this once, so a failure mid-fetch leaves the week
 * absent (and marked `error` in the ledger) rather than half-written.
 *
 * Chunked because Postgres caps bound parameters at 65535.
 */
export async function writeWeekRows(
  siteId: string,
  weekStart: string,
  isPartial: boolean,
  rows: PageWeekRow[],
  vocabulary: Set<string>,
  articleRegex: RegExp
): Promise<number> {
  if (!hasDb() || rows.length === 0) return 0;
  const db = getDb();
  const CHUNK = 400;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);

    // Dimension rows first — the facts table has no FK, but the page must
    // exist for joins to find a headline.
    const pageValues: unknown[] = [];
    const pagePlaceholders: string[] = [];
    for (const row of slice) {
      const parsed = parseArticlePath(row.pagePath, vocabulary, articleRegex);
      const base = pageValues.length;
      pagePlaceholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::text[], $${base + 6}, $${base + 7}::date, $${base + 7}::date)`
      );
      pageValues.push(
        siteId,
        row.pagePath,
        parsed?.shortId ?? null,
        parsed?.slug ?? null,
        parsed?.sections ?? [],
        parsed?.headline ?? null,
        weekStart
      );
    }
    await db.query(
      `INSERT INTO insights_pages
         (site_id, page_path, short_id, slug, sections, headline, first_week, last_week)
       VALUES ${pagePlaceholders.join(", ")}
       ON CONFLICT (site_id, page_path) DO UPDATE SET
         short_id = COALESCE(EXCLUDED.short_id, insights_pages.short_id),
         slug = COALESCE(EXCLUDED.slug, insights_pages.slug),
         sections = EXCLUDED.sections,
         headline = COALESCE(EXCLUDED.headline, insights_pages.headline),
         first_week = LEAST(insights_pages.first_week, EXCLUDED.first_week),
         last_week = GREATEST(insights_pages.last_week, EXCLUDED.last_week),
         updated_at = NOW()`,
      pageValues
    );

    const factValues: unknown[] = [];
    const factPlaceholders: string[] = [];
    for (const row of slice) {
      const base = factValues.length;
      factPlaceholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}::date, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
      );
      factValues.push(
        siteId,
        row.pagePath,
        weekStart,
        row.visitors,
        row.pageviews,
        row.visits,
        row.bounceRate,
        row.visitDuration,
        row.timeOnPage,
        isPartial
      );
    }
    const res = await db.query(
      `INSERT INTO insights_page_weeks
         (site_id, page_path, week_start, visitors, pageviews, visits,
          bounce_rate, visit_duration, time_on_page, is_partial)
       VALUES ${factPlaceholders.join(", ")}
       ON CONFLICT (site_id, page_path, week_start) DO UPDATE SET
         visitors = EXCLUDED.visitors,
         pageviews = EXCLUDED.pageviews,
         visits = EXCLUDED.visits,
         bounce_rate = EXCLUDED.bounce_rate,
         visit_duration = EXCLUDED.visit_duration,
         time_on_page = EXCLUDED.time_on_page,
         is_partial = EXCLUDED.is_partial,
         fetched_at = NOW()`,
      factValues
    );
    written += res.rowCount ?? slice.length;
  }

  return written;
}

/**
 * Backfill real titles from the monitor's RSS sync where it has them. Slugs
 * lose diacritics irreversibly, so a real title is strictly better — but the
 * monitor only retains a rolling window, so most of a 6-month backfill keeps
 * the de-slugified text. `headline_source` records which is in play.
 */
export async function syncTitlesFromMonitor(siteId: string): Promise<number> {
  if (!hasDb()) return 0;
  const res = await getDb().query(
    `UPDATE insights_pages p
        SET title = t.title,
            headline_source = 'title',
            updated_at = NOW()
       FROM (
         SELECT DISTINCT ON (page_path) page_path, title
           FROM article_titles
          WHERE site_id = $1
          ORDER BY page_path, captured_at DESC
       ) t
      WHERE p.site_id = $1
        AND p.page_path = t.page_path
        AND t.title <> ''
        AND (p.title IS DISTINCT FROM t.title)`,
    [siteId]
  );
  return res.rowCount ?? 0;
}

// --- Reads for the UI and the analysis --------------------------------------

export interface ArticleListRow {
  pagePath: string;
  headline: string;
  headlineSource: "title" | "slug";
  sections: string[];
  pageviews: number;
  visitorsSum: number;
  bounceRate: number | null;
  visitDuration: number | null;
  firstWeek: string;
  lastWeek: string;
  weeksActive: number;
}

export interface ArticleQuery {
  siteId: string;
  weekStartFrom: string;
  weekStartTo: string;
  sections?: string[];
  includePartialWeeks?: boolean;
  rankBy?: "pageviews" | "visitorsSum";
  limit?: number;
}

/**
 * One row per article, aggregated across the in-scope weeks.
 *
 * The session metrics are weighted by `visits`, not pageviews — bounce rate is
 * a per-session percentage, so a pageview-weighted average would be wrong.
 */
export async function listArticles(q: ArticleQuery): Promise<ArticleListRow[]> {
  if (!hasDb()) return [];
  const params: unknown[] = [
    q.siteId,
    q.weekStartFrom,
    q.weekStartTo,
    q.includePartialWeeks ?? false,
  ];
  let sectionClause = "";
  if (q.sections && q.sections.length > 0) {
    params.push(q.sections);
    sectionClause = ` AND p.sections && $${params.length}::text[]`;
  }
  const orderCol =
    q.rankBy === "visitorsSum" ? "visitors_sum" : "pageviews";
  params.push(Math.min(Math.max(1, q.limit ?? 300), 2000));

  const { rows } = await getDb().query(
    `SELECT p.page_path,
            COALESCE(NULLIF(p.title, ''), p.headline, p.page_path) AS headline,
            CASE WHEN NULLIF(p.title, '') IS NOT NULL THEN 'title' ELSE 'slug' END AS headline_source,
            p.sections,
            SUM(w.pageviews)::bigint AS pageviews,
            SUM(w.visitors)::bigint AS visitors_sum,
            CASE WHEN SUM(w.visits) > 0
                 THEN SUM(w.bounce_rate * w.visits) / SUM(w.visits) END AS bounce_rate,
            CASE WHEN SUM(w.visits) > 0
                 THEN SUM(w.visit_duration * w.visits) / SUM(w.visits) END AS visit_duration,
            MIN(w.week_start) AS first_week,
            MAX(w.week_start) AS last_week,
            COUNT(*)::int AS weeks_active
       FROM insights_page_weeks w
       JOIN insights_pages p
         ON p.site_id = w.site_id AND p.page_path = w.page_path
      WHERE w.site_id = $1
        AND w.week_start >= $2::date
        AND w.week_start <= $3::date
        AND ($4::boolean OR NOT w.is_partial)${sectionClause}
      GROUP BY p.page_path, p.title, p.headline, p.sections
      ORDER BY ${orderCol} DESC
      LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    pagePath: String(r.page_path),
    headline: String(r.headline ?? ""),
    headlineSource: r.headline_source === "title" ? "title" : "slug",
    sections: Array.isArray(r.sections) ? (r.sections as string[]) : [],
    pageviews: num(r.pageviews),
    visitorsSum: num(r.visitors_sum),
    bounceRate: numOrNull(r.bounce_rate),
    visitDuration: numOrNull(r.visit_duration),
    firstWeek: dateOnly(r.first_week),
    lastWeek: dateOnly(r.last_week),
    weeksActive: num(r.weeks_active),
  }));
}

export function toAggregatedArticles(
  rows: ArticleListRow[]
): AggregatedArticle[] {
  return rows.map((r, idx) => ({
    idx,
    pagePath: r.pagePath,
    headline: r.headline,
    headlineSource: r.headlineSource,
    sections: r.sections,
    pageviews: r.pageviews,
    visitorsSum: r.visitorsSum,
    bounceRate: r.bounceRate,
    visitDuration: r.visitDuration,
    firstWeek: r.firstWeek,
    lastWeek: r.lastWeek,
  }));
}

/** Per-week pageviews for the in-scope articles, for theme trend lines. */
export async function listWeeklyTotalsForPaths(
  siteId: string,
  paths: string[],
  weekStartFrom: string,
  weekStartTo: string,
  includePartialWeeks: boolean
): Promise<{ pagePath: string; weekStart: string; pageviews: number }[]> {
  if (!hasDb() || paths.length === 0) return [];
  const { rows } = await getDb().query(
    `SELECT page_path, week_start, pageviews
       FROM insights_page_weeks
      WHERE site_id = $1
        AND page_path = ANY($2::text[])
        AND week_start >= $3::date
        AND week_start <= $4::date
        AND ($5::boolean OR NOT is_partial)`,
    [siteId, paths, weekStartFrom, weekStartTo, includePartialWeeks]
  );
  return rows.map((r) => ({
    pagePath: String(r.page_path),
    weekStart: dateOnly(r.week_start),
    pageviews: num(r.pageviews),
  }));
}

export async function listSlugsForVocabulary(
  siteId: string,
  limit = 5000
): Promise<string[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query(
    `SELECT slug FROM insights_pages
      WHERE site_id = $1 AND slug IS NOT NULL AND slug <> ''
      ORDER BY updated_at DESC
      LIMIT $2`,
    [siteId, Math.min(Math.max(1, limit), 20000)]
  );
  return rows.map((r) => String(r.slug));
}

export async function listKnownSections(siteId: string): Promise<string[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query(
    `SELECT DISTINCT unnest(sections) AS section
       FROM insights_pages WHERE site_id = $1 ORDER BY section`,
    [siteId]
  );
  return rows.map((r) => String(r.section)).filter(Boolean);
}

// --- Analysis runs ----------------------------------------------------------

export interface RecordRunInput {
  siteId: string;
  params: AnalysisScope;
  promptKey: string | null;
  promptBody: string;
  modelKey: string | null;
  provider: string | null;
  modelId: string | null;
  status: "ok" | "error";
  result: InsightRunResult | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCzk: number;
  durationMs: number;
  createdBy: string;
  /** Separates themes / titles / rewrite runs in the shared history. */
  kind?: string;
}

export async function recordAnalysisRun(
  input: RecordRunInput
): Promise<number | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ id: string }>(
    `INSERT INTO insights_ai_runs
       (site_id, params, prompt_key, prompt_body, model_key, provider, model_id,
        status, result, error, input_tokens, output_tokens, cost_usd, cost_czk,
        duration_ms, created_by, kind)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
             $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      input.siteId,
      JSON.stringify(input.params),
      input.promptKey,
      input.promptBody,
      input.modelKey,
      input.provider,
      input.modelId,
      input.status,
      input.result ? JSON.stringify(input.result) : null,
      input.error,
      input.inputTokens,
      input.outputTokens,
      input.costUsd,
      input.costCzk,
      input.durationMs,
      input.createdBy,
      input.kind ?? "themes",
    ]
  );
  return rows.length ? Number(rows[0].id) : null;
}

function rowToRun(r: Record<string, unknown>): InsightRunRow {
  return {
    id: Number(r.id),
    siteId: String(r.site_id),
    params: (r.params as AnalysisScope) ?? null,
    promptKey: (r.prompt_key as string) ?? null,
    modelKey: (r.model_key as string) ?? null,
    provider: (r.provider as string) ?? null,
    modelId: (r.model_id as string) ?? null,
    status: r.status === "error" ? "error" : "ok",
    result: (r.result as InsightRunResult) ?? null,
    error: (r.error as string) ?? null,
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    costUsd: num(r.cost_usd),
    costCzk: num(r.cost_czk),
    durationMs: num(r.duration_ms),
    createdBy: (r.created_by as string) ?? null,
    createdAt: iso(r.created_at),
  };
}

export async function listAnalysisRuns(
  siteId: string,
  limit = 25,
  kind = "themes"
): Promise<InsightRunRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query(
    `SELECT id, site_id, params, prompt_key, model_key, provider, model_id,
            status, NULL::jsonb AS result, error, input_tokens, output_tokens,
            cost_usd, cost_czk, duration_ms, created_by, created_at
       FROM insights_ai_runs
      WHERE site_id = $1 AND kind = $3
      ORDER BY created_at DESC
      LIMIT $2`,
    [siteId, Math.min(Math.max(1, limit), 100), kind]
  );
  return rows.map(rowToRun);
}

export async function getAnalysisRun(id: number): Promise<InsightRunRow | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query(
    `SELECT id, site_id, params, prompt_key, model_key, provider, model_id,
            status, result, error, input_tokens, output_tokens, cost_usd,
            cost_czk, duration_ms, created_by, created_at
       FROM insights_ai_runs WHERE id = $1`,
    [id]
  );
  return rows.length ? rowToRun(rows[0]) : null;
}

export function articleRegexFor(config: InsightsConfig): RegExp {
  return buildArticleRegex(config.articlePathRegex);
}
