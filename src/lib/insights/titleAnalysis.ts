import { getDb, hasDb } from "@/lib/db";
import type { CohortArticle, TitleCohort } from "./titlePrompts";

/**
 * A section-week with a handful of articles has a meaningless median. The SE of
 * a median is ~1.253·σ/√n, and pageviews are heavy-tailed, so 12 is the lowest
 * defensible bucket. Thinner buckets fall back to an all-sections bucket for
 * the same week rather than being dropped — but that re-introduces the topic
 * confound, so the level is recorded and shown.
 */
export const MIN_BUCKET_ARTICLES = 12;

/** How many candidates to pull per ordering before balancing in memory. */
const CANDIDATE_POOL = 400;

export type BucketLevel = "section_week" | "week";

export interface CohortRow {
  pagePath: string;
  headline: string;
  headlineSource: "title" | "slug";
  sections: string[];
  primarySection: string;
  debutWeek: string;
  pageviewsWindow: number;
  visitorsWindow: number;
  bucketMedian: number | null;
  bucketSize: number | null;
  bucketLevel: BucketLevel | null;
  /** ln((pv+1)/(median+1)). Symmetric, so a top-vs-bottom read is fair. */
  logRatio: number | null;
  ratio: number | null;
  cohorts: TitleCohort[];
}

export interface CohortQuery {
  siteId: string;
  weekStartFrom: string;
  weekStartTo: string;
  tailWeeks: number;
  minPageviews: number;
  perCohort: number;
}

export interface CohortSelection {
  rows: CohortRow[];
  population: number;
  titleBackedShare: number;
  cohortSize: number;
  excludedTruncatedWeeks: string[];
  note: string | null;
}

interface RawRow {
  page_path: string;
  headline: string;
  headline_source: string;
  sections: string[] | null;
  primary_section: string;
  debut_week: unknown;
  pv_window: string | number;
  visitors_window: string | number;
  bucket_median: string | number | null;
  bucket_n: number | null;
  bucket_level: string | null;
  log_ratio: string | number | null;
  cohort: string;
}

/**
 * Four cohorts: normalised winners/losers and raw winners/losers.
 *
 * The normalised score compares an article with the median of its own section
 * in the week it debuted, over an identical exposure window for every article.
 * That is what isolates the headline from topic and timing. The raw cohorts
 * answer a different question — they mostly surface popular *topics* — and the
 * contrast between the two is the point of showing both.
 *
 * Three guards matter more than they look:
 *
 *  - **Truncated weeks are excluded entirely.** A truncated week hit the page
 *    cap, so it is missing its long tail: its low performers are *absent, not
 *    zero*. Feeding one into a bottom-cohort analysis would make "bottom"
 *    actually the middle of the distribution — a silent inversion of the whole
 *    feature. This is why the ledger is joined at all.
 *  - **Left-censoring.** An article whose debut equals the earliest loaded week
 *    was already live before we started looking, so its debut was never seen.
 *  - **No per-week row requirement.** Plausible omits zero-traffic pages, so a
 *    genuine flop simply has no row in a later week. Requiring one would delete
 *    exactly the articles this feature exists to find.
 */
export async function listTitleCohorts(
  q: CohortQuery
): Promise<CohortSelection> {
  const empty: CohortSelection = {
    rows: [],
    population: 0,
    titleBackedShare: 0,
    cohortSize: 0,
    excludedTruncatedWeeks: [],
    note: null,
  };
  if (!hasDb()) return empty;

  const tailWeeks = Math.min(Math.max(0, Math.round(q.tailWeeks)), 4);
  const minPv = Math.max(1, Math.round(q.minPageviews));

  const { rows: badWeeks } = await getDb().query<{ week_start: unknown }>(
    `SELECT week_start FROM insights_backfill_weeks
      WHERE site_id = $1 AND week_start >= $2::date AND week_start <= $3::date
        AND (status <> 'ok' OR is_partial OR truncated)
      ORDER BY week_start`,
    [q.siteId, q.weekStartFrom, q.weekStartTo]
  );
  const excludedTruncatedWeeks = badWeeks.map((r) =>
    r.week_start instanceof Date
      ? r.week_start.toISOString().slice(0, 10)
      : String(r.week_start).slice(0, 10)
  );

  const { rows } = await getDb().query<RawRow>(
    `WITH good_weeks AS (
       SELECT week_start FROM insights_backfill_weeks
        WHERE site_id = $1 AND status = 'ok'
          AND NOT is_partial AND NOT truncated
     ),
     bounds AS (
       SELECT MIN(week_start) AS first_good, MAX(week_start) AS last_good
         FROM good_weeks
     ),
     debut AS (
       SELECT pg.page_path,
              COALESCE(NULLIF(pg.sections[1], ''), '(bez rubriky)') AS primary_section,
              pg.first_week AS debut_week
         FROM insights_pages pg, bounds b
        WHERE pg.site_id = $1
          AND pg.first_week IS NOT NULL
          AND pg.first_week >= $2::date
          AND pg.first_week <= $3::date
          AND pg.first_week > b.first_good
          AND pg.first_week + ($4::int * 7) <= b.last_good
          AND NOT EXISTS (
            SELECT 1 FROM generate_series(0, $4::int) AS o(n)
             WHERE (pg.first_week + o.n * 7) NOT IN (SELECT week_start FROM good_weeks)
          )
     ),
     windowed AS (
       SELECT d.page_path, d.primary_section, d.debut_week,
              SUM(w.pageviews)::bigint AS pv_window,
              SUM(w.visitors)::bigint AS visitors_window
         FROM debut d
         JOIN insights_page_weeks w
           ON w.site_id = $1 AND w.page_path = d.page_path
          AND w.week_start >= d.debut_week
          AND w.week_start <= d.debut_week + ($4::int * 7)
        GROUP BY d.page_path, d.primary_section, d.debut_week
     ),
     eligible AS (
       SELECT * FROM windowed WHERE pv_window >= $5::int
     ),
     b_section AS (
       SELECT primary_section, debut_week, COUNT(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY pv_window::double precision) AS med
         FROM eligible GROUP BY primary_section, debut_week
     ),
     b_week AS (
       SELECT debut_week, COUNT(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY pv_window::double precision) AS med
         FROM eligible GROUP BY debut_week
     ),
     scored AS (
       SELECT e.page_path, e.primary_section, e.debut_week,
              e.pv_window, e.visitors_window,
              CASE WHEN bs.n >= $6::int THEN 'section_week' ELSE 'week' END AS bucket_level,
              CASE WHEN bs.n >= $6::int THEN bs.n ELSE bw.n END AS bucket_n,
              CASE WHEN bs.n >= $6::int THEN bs.med ELSE bw.med END AS bucket_median,
              LN((e.pv_window + 1)::double precision
                 / (CASE WHEN bs.n >= $6::int THEN bs.med ELSE bw.med END + 1)) AS log_ratio
         FROM eligible e
         JOIN b_section bs
           ON bs.primary_section = e.primary_section AND bs.debut_week = e.debut_week
         JOIN b_week bw ON bw.debut_week = e.debut_week
     ),
     nw AS (SELECT 'normalizovani_vitezove' AS cohort, * FROM scored
             ORDER BY log_ratio DESC, page_path LIMIT $7::int),
     nl AS (SELECT 'normalizovani_propadaky' AS cohort, * FROM scored
             ORDER BY log_ratio ASC, page_path LIMIT $7::int),
     aw AS (SELECT 'absolutni_vitezove' AS cohort, * FROM scored
             ORDER BY pv_window DESC, page_path LIMIT $7::int),
     -- The raw bottom is drawn from a mass tie: thousands of articles sit at
     -- the floor, so a plain ASC sort returns an arbitrary slice rather than
     -- "the worst". A hash tiebreak makes the slice reproducible and unbiased.
     al AS (SELECT 'absolutni_propadaky' AS cohort, * FROM scored
             ORDER BY pv_window ASC, md5(page_path || $1) LIMIT $7::int),
     picked AS (
       SELECT * FROM nw UNION ALL SELECT * FROM nl
       UNION ALL SELECT * FROM aw UNION ALL SELECT * FROM al
     )
     SELECT k.cohort, k.page_path, k.primary_section, k.debut_week,
            k.pv_window, k.visitors_window, k.bucket_level, k.bucket_n,
            k.bucket_median, k.log_ratio,
            COALESCE(NULLIF(pg.title, ''), pg.headline, k.page_path) AS headline,
            CASE WHEN NULLIF(pg.title, '') IS NOT NULL THEN 'title' ELSE 'slug' END AS headline_source,
            pg.sections
       FROM picked k
       JOIN insights_pages pg ON pg.site_id = $1 AND pg.page_path = k.page_path`,
    [
      q.siteId,
      q.weekStartFrom,
      q.weekStartTo,
      tailWeeks,
      minPv,
      MIN_BUCKET_ARTICLES,
      CANDIDATE_POOL,
    ]
  );

  const { rows: popRows } = await getDb().query<{ n: string }>(
    `SELECT COUNT(*)::bigint AS n FROM insights_pages
      WHERE site_id = $1 AND first_week >= $2::date AND first_week <= $3::date`,
    [q.siteId, q.weekStartFrom, q.weekStartTo]
  );
  const population = popRows.length ? Number(popRows[0].n) : 0;

  const merged = mergeCohorts(rows);
  const selection = pickBalanced(merged, q.perCohort);
  const titleBacked = selection.filter((r) => r.headlineSource === "title").length;

  return {
    rows: selection,
    population,
    titleBackedShare:
      selection.length > 0
        ? Math.round((titleBacked / selection.length) * 1000) / 10
        : 0,
    cohortSize: q.perCohort,
    excludedTruncatedWeeks,
    note:
      excludedTruncatedWeeks.length > 0
        ? `Vynecháno ${excludedTruncatedWeeks.length} týdnů, které nejsou úplně načtené.`
        : null,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mergeCohorts(rows: RawRow[]): CohortRow[] {
  // One article can be both a normalised and a raw winner; show it once with
  // every label so the model sees the overlap instead of a duplicate title.
  const byPath = new Map<string, CohortRow>();
  for (const r of rows) {
    const pagePath = String(r.page_path);
    const cohort = String(r.cohort) as TitleCohort;
    const existing = byPath.get(pagePath);
    if (existing) {
      if (!existing.cohorts.includes(cohort)) existing.cohorts.push(cohort);
      continue;
    }
    const logRatio = r.log_ratio === null ? null : num(r.log_ratio);
    byPath.set(pagePath, {
      pagePath,
      headline: String(r.headline ?? ""),
      headlineSource: r.headline_source === "title" ? "title" : "slug",
      sections: Array.isArray(r.sections) ? r.sections : [],
      primarySection: String(r.primary_section ?? "(bez rubriky)"),
      debutWeek:
        r.debut_week instanceof Date
          ? r.debut_week.toISOString().slice(0, 10)
          : String(r.debut_week ?? "").slice(0, 10),
      pageviewsWindow: num(r.pv_window),
      visitorsWindow: num(r.visitors_window),
      bucketMedian: r.bucket_median === null ? null : num(r.bucket_median),
      bucketSize: r.bucket_n === null ? null : num(r.bucket_n),
      bucketLevel:
        r.bucket_level === "section_week"
          ? "section_week"
          : r.bucket_level === "week"
            ? "week"
            : null,
      logRatio,
      ratio: logRatio === null ? null : Math.exp(logRatio),
      cohorts: [cohort],
    });
  }
  return [...byPath.values()];
}

/**
 * Balance the cohorts before they reach the model.
 *
 * Live blogs and serials ("Válka na Ukrajině — 512. den") produce dozens of
 * near-identical titles from one section-week. Let thirty of them into the
 * bottom cohort and the model will confidently report that serial numbering
 * underperforms, when the real cause is that live blogs accrue traffic
 * differently. Capping each bucket's contribution prevents that.
 */
function pickBalanced(rows: CohortRow[], perCohort: number): CohortRow[] {
  const size = Math.min(Math.max(5, perCohort), 150);
  const maxPerBucket = Math.max(2, Math.ceil(size / 12));
  const cohorts: TitleCohort[] = [
    "normalizovani_vitezove",
    "normalizovani_propadaky",
    "absolutni_vitezove",
    "absolutni_propadaky",
  ];

  const chosen = new Map<string, CohortRow>();
  for (const cohort of cohorts) {
    const pool = rows.filter((r) => r.cohorts.includes(cohort));
    const bucketCount = new Map<string, number>();
    let taken = 0;
    for (const row of pool) {
      if (taken >= size) break;
      const bucket = `${row.primarySection}|${row.debutWeek}`;
      const used = bucketCount.get(bucket) ?? 0;
      if (used >= maxPerBucket) continue;
      bucketCount.set(bucket, used + 1);
      taken += 1;
      const already = chosen.get(row.pagePath);
      if (already) {
        if (!already.cohorts.includes(cohort)) already.cohorts.push(cohort);
      } else {
        chosen.set(row.pagePath, { ...row, cohorts: [cohort] });
      }
    }
  }
  return [...chosen.values()];
}

/** Indexes are the only handle the model gets on an article. */
export function toCohortArticles(rows: CohortRow[]): CohortArticle[] {
  return rows.map((r, idx) => ({
    idx,
    pagePath: r.pagePath,
    headline: r.headline,
    headlineSource: r.headlineSource,
    sections: r.sections,
    pageviews: r.pageviewsWindow,
    visitorsSum: r.visitorsWindow,
    bounceRate: null,
    visitDuration: null,
    firstWeek: r.debutWeek,
    lastWeek: r.debutWeek,
    cohorts: r.cohorts,
  }));
}
