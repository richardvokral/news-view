// Turns the model's prose-plus-indexes into the standardized result by
// recomputing every number from the real rows.
//
// The invariant that makes this airtight: assigned + unassigned === total,
// always. A model that returns nothing yields "everything unassigned" rather
// than wrong numbers.

import type { RawThemeOutput } from "./providers";
import type {
  AggregatedArticle,
  AnalysisScope,
  HeadlinePattern,
  InsightRunResult,
  InsightTheme,
  MetricTier,
  SectionSummaryRow,
  ThemeArticle,
} from "./types";

export interface WeeklyPoint {
  pagePath: string;
  weekStart: string;
  pageviews: number;
}

function toThemeArticle(a: AggregatedArticle): ThemeArticle {
  return {
    pagePath: a.pagePath,
    headline: a.headline,
    sections: a.sections,
    pageviews: a.pageviews,
    visitorsSum: a.visitorsSum,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Least-squares slope over the weekly series, normalised by the mean. */
function trendOf(
  weekly: { weekStart: string; pageviews: number }[]
): "rising" | "flat" | "declining" {
  if (weekly.length < 3) return "flat";
  const ys = weekly.map((w) => w.pageviews);
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  if (meanY <= 0) return "flat";
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (ys[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return "flat";
  const normalized = (num / den) / meanY;
  if (normalized > 0.05) return "rising";
  if (normalized < -0.05) return "declining";
  return "flat";
}

function buildTheme(
  themeId: string,
  name: string,
  summary: string,
  whyItWorked: string,
  aiSectionLabels: string[],
  members: AggregatedArticle[],
  totalPageviews: number,
  weeklyByPath: Map<string, Map<string, number>>,
  allWeeks: string[]
): InsightTheme {
  const pageviewsSum = members.reduce((s, a) => s + a.pageviews, 0);
  const visitorsSum = members.reduce((s, a) => s + a.visitorsSum, 0);

  // Session metrics are per-session, so they average over articles that
  // actually have them rather than over the whole theme.
  const withBounce = members.filter((a) => a.bounceRate !== null);
  const withDuration = members.filter((a) => a.visitDuration !== null);

  const weekly = allWeeks.map((weekStart) => {
    let pageviews = 0;
    for (const a of members) {
      pageviews += weeklyByPath.get(a.pagePath)?.get(weekStart) ?? 0;
    }
    return { weekStart, pageviews };
  });

  const sectionCounts = new Map<string, { articleCount: number; pageviews: number }>();
  for (const a of members) {
    for (const s of a.sections.length ? a.sections : ["(bez rubriky)"]) {
      const cur = sectionCounts.get(s) ?? { articleCount: 0, pageviews: 0 };
      cur.articleCount += 1;
      cur.pageviews += a.pageviews;
      sectionCounts.set(s, cur);
    }
  }

  const sorted = [...members].sort((a, b) => b.pageviews - a.pageviews);

  return {
    themeId,
    name,
    summary,
    whyItWorked,
    aiSectionLabels,
    articles: sorted.map(toThemeArticle),
    articleCount: members.length,
    pageviewsSum,
    visitorsSum,
    shareOfPageviews:
      totalPageviews > 0 ? round((pageviewsSum / totalPageviews) * 100) : 0,
    avgPageviewsPerArticle:
      members.length > 0 ? Math.round(pageviewsSum / members.length) : 0,
    medianPageviewsPerArticle: Math.round(
      median(members.map((a) => a.pageviews))
    ),
    topArticle: sorted.length ? toThemeArticle(sorted[0]) : null,
    weeklyPageviews: weekly,
    sectionMix: [...sectionCounts.entries()]
      .map(([section, v]) => ({ section, ...v }))
      .sort((a, b) => b.pageviews - a.pageviews),
    trend: trendOf(weekly),
    avgBounceRate: withBounce.length
      ? round(
          withBounce.reduce((s, a) => s + (a.bounceRate ?? 0), 0) /
            withBounce.length
        )
      : null,
    avgVisitDurationSec: withDuration.length
      ? round(
          withDuration.reduce((s, a) => s + (a.visitDuration ?? 0), 0) /
            withDuration.length
        )
      : null,
  };
}

export interface GroundOptions {
  scope: AnalysisScope;
  metricsTierSeen: MetricTier | null;
  articles: AggregatedArticle[];
  weekly: WeeklyPoint[];
  raw: RawThemeOutput;
}

export function groundAnalysis(opts: GroundOptions): InsightRunResult {
  const { articles, raw } = opts;
  const byIdx = new Map(articles.map((a) => [a.idx, a]));
  const totalPageviews = articles.reduce((s, a) => s + a.pageviews, 0);
  const totalVisitorsSum = articles.reduce((s, a) => s + a.visitorsSum, 0);

  const weeklyByPath = new Map<string, Map<string, number>>();
  const weekSet = new Set<string>();
  for (const p of opts.weekly) {
    weekSet.add(p.weekStart);
    let inner = weeklyByPath.get(p.pagePath);
    if (!inner) {
      inner = new Map();
      weeklyByPath.set(p.pagePath, inner);
    }
    inner.set(p.weekStart, (inner.get(p.weekStart) ?? 0) + p.pageviews);
  }
  const allWeeks = [...weekSet].sort();

  // Validate indexes: out-of-range are dropped, first theme wins a duplicate.
  const claimed = new Set<number>();
  const droppedIndexes: number[] = [];
  const duplicateIndexes: number[] = [];

  const themes: InsightTheme[] = raw.themes.map((t, i) => {
    const members: AggregatedArticle[] = [];
    for (const idx of t.article_indexes) {
      const article = byIdx.get(idx);
      if (!article) {
        droppedIndexes.push(idx);
        continue;
      }
      if (claimed.has(idx)) {
        duplicateIndexes.push(idx);
        continue;
      }
      claimed.add(idx);
      members.push(article);
    }
    return buildTheme(
      `t${i}`,
      t.name,
      t.summary,
      t.why_it_worked,
      t.editorial_sections ?? [],
      members,
      totalPageviews,
      weeklyByPath,
      allWeeks
    );
  });

  themes.sort((a, b) => b.pageviewsSum - a.pageviewsSum);

  const unassignedMembers = articles.filter((a) => !claimed.has(a.idx));
  const unassigned = buildTheme(
    "unassigned",
    "Nezařazeno",
    "",
    "",
    [],
    unassignedMembers,
    totalPageviews,
    weeklyByPath,
    allWeeks
  );

  // Sections come from the parsed slug, never from the model's labels.
  const sectionAgg = new Map<string, { articleCount: number; pageviewsSum: number }>();
  for (const a of articles) {
    for (const s of a.sections.length ? a.sections : ["(bez rubriky)"]) {
      const cur = sectionAgg.get(s) ?? { articleCount: 0, pageviewsSum: 0 };
      cur.articleCount += 1;
      cur.pageviewsSum += a.pageviews;
      sectionAgg.set(s, cur);
    }
  }
  const sections: SectionSummaryRow[] = [...sectionAgg.entries()]
    .map(([section, v]) => ({
      section,
      articleCount: v.articleCount,
      pageviewsSum: v.pageviewsSum,
      avgPageviews: Math.round(v.pageviewsSum / v.articleCount),
      shareOfPageviews:
        totalPageviews > 0 ? round((v.pageviewsSum / totalPageviews) * 100) : 0,
    }))
    .sort((a, b) => b.pageviewsSum - a.pageviewsSum);

  // Headline patterns: the model labels, the server measures the lift.
  const meanPageviews =
    articles.length > 0 ? totalPageviews / articles.length : 0;
  const headlinePatterns: HeadlinePattern[] = (raw.headline_patterns ?? [])
    .map((p) => {
      const members = p.article_indexes
        .map((idx) => byIdx.get(idx))
        .filter((a): a is AggregatedArticle => a !== undefined);
      if (members.length === 0) return null;
      const sum = members.reduce((s, a) => s + a.pageviews, 0);
      const avg = sum / members.length;
      return {
        label: p.label,
        note: p.note,
        articleCount: members.length,
        avgPageviews: Math.round(avg),
        liftPct:
          meanPageviews > 0 ? round(((avg - meanPageviews) / meanPageviews) * 100) : 0,
        examplePaths: members
          .sort((a, b) => b.pageviews - a.pageviews)
          .slice(0, 3)
          .map((a) => a.pagePath),
      };
    })
    .filter((p): p is HeadlinePattern => p !== null)
    .sort((a, b) => b.liftPct - a.liftPct);

  const titleBacked = articles.filter((a) => a.headlineSource === "title").length;

  return {
    scope: {
      ...opts.scope,
      metricsTierSeen: opts.metricsTierSeen,
      articlesConsidered: articles.length,
      titleBackedShare:
        articles.length > 0 ? round((titleBacked / articles.length) * 100) : 0,
    },
    totals: {
      articles: articles.length,
      pageviews: totalPageviews,
      visitorsSum: totalVisitorsSum,
      weeks: allWeeks.length,
    },
    takeaway: raw.overall_narrative,
    themes,
    unassigned,
    sections,
    headlinePatterns,
    observations: raw.notes ?? [],
    recommendations: raw.recommendations,
    reconciliation: {
      assigned: claimed.size,
      unassigned: unassignedMembers.length,
      total: articles.length,
      droppedIndexes: [...new Set(droppedIndexes)],
      duplicateIndexes: [...new Set(duplicateIndexes)],
    },
  };
}
