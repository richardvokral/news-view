// Shared types for the /insights surface.

/**
 * Metric ladder for the Plausible breakdown. Tier 0 is what we want; each step
 * down drops metrics that some Plausible versions reject on an `event:page`
 * breakdown. The current docs say session metrics are allowed on `event:page`,
 * but self-hosted instances vary, so the fetcher probes once per run and
 * records which tier actually worked.
 *
 * `visits` earns its own tier because the weighted averages depend on it:
 * bounce_rate and visit_duration are session metrics, so averaging them across
 * weeks must be weighted by visits, never by pageviews.
 */
export const METRIC_TIERS = [
  "visitors,pageviews,visits,bounce_rate,visit_duration,time_on_page",
  "visitors,pageviews,visits,bounce_rate,visit_duration",
  "visitors,pageviews,visits",
  "visitors,pageviews",
] as const;

export type MetricTier = 0 | 1 | 2 | 3;

export const LOWEST_METRIC_TIER: MetricTier = 3;

export interface InsightsConfig {
  backfillWeeks: number;
  weeksPerRequest: number;
  pageLimit: number;
  maxPagesPerWeek: number;
  maxRequestsPerRun: number;
  refetchGraceHours: number;
  /** Plausible filter value, e.g. `/a/**`. Empty = fetch unfiltered. */
  articlePathFilter: string;
  /** Local regex deciding what counts as an article. Empty = a sane default. */
  articlePathRegex: string;
  sectionVocabulary: string[];
  aiModelKey: string | null;
  aiTopArticles: number;
  titleFetchPerRun: number;
  /**
   * Weeks after debut counted toward a title's score. 0 = the debut week only.
   * Tune from the decay profile: hard news usually puts 85-95% of an article's
   * lifetime pageviews in its first week, which makes 0 right and simplest.
   */
  titleTailWeeks: number;
  /**
   * Floor for the title cohorts. Its real job is excluding mis-parsed paths
   * (AMP variants, redirects), not excluding genuine flops — a one-pageview
   * article against a median of 200 is a real flop and exactly the signal the
   * bottom cohort wants. Keep it low.
   */
  titleMinPageviews: number;
  /** Trailing site-name suffixes stripped from a fetched og:title. */
  titleStripSuffixes: string[];
  updatedBy: string | null;
  updatedAt: string | null;
}

export const DEFAULT_INSIGHTS_CONFIG: InsightsConfig = {
  backfillWeeks: 26,
  weeksPerRequest: 4,
  pageLimit: 1000,
  maxPagesPerWeek: 20,
  maxRequestsPerRun: 150,
  refetchGraceHours: 48,
  articlePathFilter: "",
  articlePathRegex: "",
  sectionVocabulary: [],
  aiModelKey: null,
  aiTopArticles: 300,
  titleFetchPerRun: 200,
  titleTailWeeks: 0,
  titleMinPageviews: 10,
  titleStripSuffixes: [],
  updatedBy: null,
  updatedAt: null,
};

export interface WeekRange {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Sunday, `YYYY-MM-DD`. Inclusive. */
  weekEnd: string;
}

export interface WeekLedgerRow extends WeekRange {
  siteId: string;
  status: "pending" | "ok" | "error";
  isPartial: boolean;
  truncated: boolean;
  metricsTier: MetricTier | null;
  rowsWritten: number;
  apiCalls: number;
  error: string | null;
  fetchedAt: string | null;
}

export interface PageWeekRow {
  pagePath: string;
  visitors: number;
  pageviews: number;
  visits: number | null;
  bounceRate: number | null;
  visitDuration: number | null;
  timeOnPage: number | null;
}

export type BackfillSkipReason =
  | "no_sites"
  | "rate_capped"
  | "locked"
  | "redis_unavailable"
  | "cancelled"
  | "not_configured";

export interface BackfillChunkResult {
  ok: boolean;
  runKey: string;
  siteId: string;
  skippedReason?: BackfillSkipReason;
  metricsTier: MetricTier | null;
  pathFilter: string | null;
  processed: {
    weekStart: string;
    rows: number;
    apiCalls: number;
    truncated: boolean;
  }[];
  /** Complete weeks still missing. Excludes the current, always-partial week. */
  remaining: number;
  refreshedCurrentWeek: boolean;
  apiCallsUsed: number;
  requestsThisHour: number;
  aborted?: { weekStart: string | null; stage: string; error: string };
}

// --- Analysis ---------------------------------------------------------------

export interface AggregatedArticle {
  /** Stable index handed to the model; the only way it may refer to articles. */
  idx: number;
  pagePath: string;
  headline: string;
  headlineSource: "title" | "slug";
  sections: string[];
  pageviews: number;
  /** SUM of weekly uniques — overcounts real uniques. Never call it "visitors". */
  visitorsSum: number;
  bounceRate: number | null;
  visitDuration: number | null;
  firstWeek: string;
  lastWeek: string;
}

export interface AnalysisScope {
  siteId: string;
  weekStartFrom: string;
  weekStartTo: string;
  sections: string[];
  includePartialWeeks: boolean;
  rankBy: "pageviews" | "visitorsSum";
  topN: number;
}

export interface ThemeArticle {
  pagePath: string;
  headline: string;
  sections: string[];
  pageviews: number;
  visitorsSum: number;
}

/** Every numeric field here is server-computed. Only the prose is AI-authored. */
export interface InsightTheme {
  themeId: string;
  name: string;
  summary: string;
  whyItWorked: string;
  aiSectionLabels: string[];
  articles: ThemeArticle[];
  articleCount: number;
  pageviewsSum: number;
  visitorsSum: number;
  shareOfPageviews: number;
  avgPageviewsPerArticle: number;
  medianPageviewsPerArticle: number;
  topArticle: ThemeArticle | null;
  weeklyPageviews: { weekStart: string; pageviews: number }[];
  sectionMix: { section: string; articleCount: number; pageviews: number }[];
  trend: "rising" | "flat" | "declining";
  avgBounceRate: number | null;
  avgVisitDurationSec: number | null;
}

export interface HeadlinePattern {
  label: string;
  note: string;
  articleCount: number;
  avgPageviews: number;
  /** Percent difference vs the mean across all analysed articles. */
  liftPct: number;
  examplePaths: string[];
}

export interface SectionSummaryRow {
  section: string;
  articleCount: number;
  pageviewsSum: number;
  avgPageviews: number;
  shareOfPageviews: number;
}

export interface InsightRunResult {
  scope: AnalysisScope & {
    metricsTierSeen: MetricTier | null;
    articlesConsidered: number;
    titleBackedShare: number;
  };
  totals: {
    articles: number;
    pageviews: number;
    visitorsSum: number;
    weeks: number;
  };
  takeaway: string;
  themes: InsightTheme[];
  unassigned: InsightTheme;
  sections: SectionSummaryRow[];
  headlinePatterns: HeadlinePattern[];
  observations: string[];
  recommendations: string[];
  reconciliation: {
    assigned: number;
    unassigned: number;
    total: number;
    droppedIndexes: number[];
    duplicateIndexes: number[];
  };
}

export interface InsightRunRow {
  id: number;
  siteId: string;
  params: AnalysisScope | null;
  promptKey: string | null;
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
  createdBy: string | null;
  createdAt: string;
}
