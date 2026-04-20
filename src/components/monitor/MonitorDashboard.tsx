"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ArticleSparkline from "./ArticleSparkline";
import ArticleRowDetails from "./ArticleRowDetails";
import TopSourcesWidget from "./TopSourcesWidget";
import MonitorFilters, {
  applyNumericFilter,
  type FiltersState,
  type NumericFilter,
  type NumericOp,
} from "./MonitorFilters";
import SiteSelector from "@/components/reports/SiteSelector";
import {
  computeTrendScore,
  formatTrendScore,
  computeFirstHourGrowth,
} from "@/lib/monitor/trend";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews: number | null;
}

interface Article {
  pagePath: string;
  siteId: string;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  currentVisitors: number;
  currentPageviews: number;
  snapshots: Snapshot[];
  title: string | null;
  imageUrl: string | null;
  titleUpdatedAt: string | null;
  titleChanged: boolean;
  hasStoredSources: boolean;
  topAuthors: { name: string; visitors: number }[];
}

interface Props {
  sites: string[];
  currentSite: string;
  siteBaseUrl: string;
  defaultHours: number;
  trendWindowMinutes: number;
  sourceTimeseriesEnabled: boolean;
  showArticleImages: boolean;
  authorShortNames: Record<string, string>;
  enabled: boolean;
  isAdmin: boolean;
}

type SortKey =
  | "article"
  | "visitors"
  | "pageviews"
  | "firstSeen"
  | "firstHour"
  | "trend";
type SortDir = "asc" | "desc";

const BASE_HOUR_OPTIONS = [
  { value: 1, label: "1 hour", short: "1h" },
  { value: 6, label: "6 hours", short: "6h" },
  { value: 24, label: "24 hours", short: "24h" },
  { value: 48, label: "2 days", short: "2d" },
  { value: 72, label: "3 days", short: "3d" },
];

function buildHourOptions(defaultHours: number) {
  const options = [...BASE_HOUR_OPTIONS];
  if (!options.some((o) => o.value === defaultHours)) {
    const label = defaultHours % 24 === 0
      ? `${defaultHours / 24} days`
      : `${defaultHours} hours`;
    const short = defaultHours % 24 === 0
      ? `${defaultHours / 24}d`
      : `${defaultHours}h`;
    options.push({ value: defaultHours, label, short });
    options.sort((a, b) => a.value - b.value);
  }
  return options;
}

const NUMERIC_OPS: readonly NumericOp[] = [">", ">=", "<", "<="] as const;

function parseArticleName(page: string): string {
  const trimmed = page.replace(/^\//, "");
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1] || trimmed;
  const stripped = last.replace(/\.(html?|php)$/i, "");
  const cleaned = stripped.replace(/[-_.]+/g, " ").trim();
  return cleaned || page;
}

function relTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function firstSeenCutoffFor(hoursWithin: number | null): number | null {
  if (!hoursWithin) return null;
  return Date.now() - hoursWithin * 3600_000;
}

function parseNumericParam(
  params: URLSearchParams,
  key: string
): NumericFilter | null {
  const raw = params.get(key);
  if (!raw) return null;
  const match = raw.match(/^(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const op = match[1] as NumericOp;
  if (!NUMERIC_OPS.includes(op)) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  return { op, value };
}

function serializeNumeric(filter: NumericFilter | null): string | null {
  if (!filter) return null;
  return `${filter.op}${filter.value}`;
}

function filtersFromParams(params: URLSearchParams): FiltersState {
  const firstSeen = params.get("fs");
  return {
    article: params.get("q") ?? "",
    visitors: parseNumericParam(params, "fv"),
    pageviews: parseNumericParam(params, "fp"),
    trend: parseNumericParam(params, "ft"),
    firstHour: parseNumericParam(params, "fh"),
    firstSeenWithinHours: firstSeen ? Number(firstSeen) : null,
  };
}

function sortFromParams(params: URLSearchParams): {
  key: SortKey;
  dir: SortDir;
} {
  const key = (params.get("sort") as SortKey | null) ?? "visitors";
  const dir = (params.get("dir") as SortDir | null) ?? "desc";
  const validKey: SortKey = (
    [
      "article",
      "visitors",
      "pageviews",
      "firstSeen",
      "firstHour",
      "trend",
    ] as SortKey[]
  ).includes(key)
    ? key
    : "visitors";
  const validDir: SortDir = dir === "asc" ? "asc" : "desc";
  return { key: validKey, dir: validDir };
}

export default function MonitorDashboard({
  sites,
  currentSite,
  siteBaseUrl,
  defaultHours,
  trendWindowMinutes,
  sourceTimeseriesEnabled,
  showArticleImages,
  authorShortNames,
  enabled,
  isAdmin,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hoursParam = searchParams.get("hours");
  const hours = hoursParam ? Math.max(1, Number(hoursParam)) : defaultHours;
  const hourOptions = useMemo(() => buildHourOptions(defaultHours), [
    defaultHours,
  ]);
  const { key: sortKey, dir: sortDir } = sortFromParams(searchParams);
  const filters = useMemo(
    () => filtersFromParams(searchParams),
    [searchParams]
  );
  const sourceFilter = searchParams.get("source");
  const hiddenSources = useMemo(() => {
    const raw = searchParams.get("hide") ?? "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [searchParams]);
  const expandedPath = searchParams.get("expand");

  const [articles, setArticles] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcePagePaths, setSourcePagePaths] = useState<{
    source: string;
    pagePaths: string[];
    meta?: {
      plausibleCount: number;
      dbCount: number;
      unionCount: number;
      plausibleError: string | null;
      dbError: string | null;
    };
  } | null>(null);
  const loading = articles === null && error === null;
  const sourceLoading =
    sourceFilter !== null &&
    (sourcePagePaths === null || sourcePagePaths.source !== sourceFilter);

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const qs = next.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      if (options?.replace) {
        router.replace(target, { scroll: false });
      } else {
        router.push(target, { scroll: false });
      }
    },
    [router, pathname, searchParams]
  );

  const setSortParam = useCallback(
    (key: SortKey) => {
      updateParams((params) => {
        const current = params.get("sort");
        const currentDir = params.get("dir");
        if (current === key) {
          params.set("dir", currentDir === "asc" ? "desc" : "asc");
        } else {
          params.set("sort", key);
          params.set("dir", key === "article" || key === "firstSeen" ? "asc" : "desc");
        }
      });
    },
    [updateParams]
  );

  const setFiltersParam = useCallback(
    (next: FiltersState) => {
      updateParams((params) => {
        if (next.article) params.set("q", next.article);
        else params.delete("q");
        const v = serializeNumeric(next.visitors);
        if (v) params.set("fv", v);
        else params.delete("fv");
        const p = serializeNumeric(next.pageviews);
        if (p) params.set("fp", p);
        else params.delete("fp");
        const t = serializeNumeric(next.trend);
        if (t) params.set("ft", t);
        else params.delete("ft");
        const h = serializeNumeric(next.firstHour);
        if (h) params.set("fh", h);
        else params.delete("fh");
        if (next.firstSeenWithinHours)
          params.set("fs", String(next.firstSeenWithinHours));
        else params.delete("fs");
      }, { replace: true });
    },
    [updateParams]
  );

  const setHours = useCallback(
    (value: number) => {
      updateParams((params) => {
        params.set("hours", String(value));
      }, { replace: true });
    },
    [updateParams]
  );

  const setSourceFilter = useCallback(
    (source: string | null) => {
      updateParams((params) => {
        if (source) params.set("source", source);
        else params.delete("source");
      });
    },
    [updateParams]
  );

  const writeHidden = useCallback(
    (list: string[]) => {
      updateParams(
        (params) => {
          const dedup = Array.from(
            new Set(list.map((s) => s.trim()).filter(Boolean))
          );
          if (dedup.length === 0) params.delete("hide");
          else params.set("hide", dedup.join(","));
        },
        { replace: true }
      );
    },
    [updateParams]
  );

  const hideSource = useCallback(
    (source: string) => writeHidden([...hiddenSources, source]),
    [hiddenSources, writeHidden]
  );
  const unhideSource = useCallback(
    (source: string) => writeHidden(hiddenSources.filter((s) => s !== source)),
    [hiddenSources, writeHidden]
  );
  const clearHidden = useCallback(() => writeHidden([]), [writeHidden]);

  const setExpandedPath = useCallback(
    (pagePath: string | null) => {
      updateParams((params) => {
        if (pagePath) params.set("expand", pagePath);
        else params.delete("expand");
      }, { replace: true });
    },
    [updateParams]
  );

  const fetchArticles = useCallback(() => {
    if (!enabled || !currentSite) return;
    const params = new URLSearchParams({
      site: currentSite,
      hours: String(hours),
    });
    fetch(`/api/monitor/articles?${params}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)
      )
      .then((data) => {
        setArticles(data.articles || []);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, [currentSite, hours, enabled]);

  useEffect(() => {
    fetchArticles();
    if (!enabled) return;
    const interval = setInterval(fetchArticles, 60_000);
    return () => clearInterval(interval);
  }, [fetchArticles, enabled]);

  // Fetch page paths attributable to the active source.
  const sourceReq = useRef<AbortController | null>(null);
  useEffect(() => {
    sourceReq.current?.abort();
    if (!sourceFilter || !currentSite) return;
    const ctrl = new AbortController();
    sourceReq.current = ctrl;
    const params = new URLSearchParams({
      site: currentSite,
      hours: String(hours),
      source: sourceFilter,
    });
    fetch(`/api/monitor/sources?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) =>
        setSourcePagePaths({
          source: sourceFilter,
          pagePaths: (d.pagePaths || []) as string[],
          meta: d.meta,
        })
      )
      .catch((e) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setSourcePagePaths({ source: sourceFilter, pagePaths: [] });
      });
    return () => ctrl.abort();
  }, [sourceFilter, currentSite, hours]);

  // Fetch per-page contributions for hidden sources so we can subtract them
  // from the article visitor/pageview counts.
  const [hiddenContribs, setHiddenContribs] = useState<{
    hiddenKey: string;
    contributions: Record<string, { visitors: number; pageviews: number }>;
  } | null>(null);
  const hiddenKey = hiddenSources.join("|");
  useEffect(() => {
    if (hiddenKey === "" || !currentSite) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams({
      site: currentSite,
      hours: String(hours),
      sources: hiddenKey.split("|").join(","),
    });
    fetch(`/api/monitor/source-contributions?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        setHiddenContribs({
          hiddenKey,
          contributions: (d.contributions ?? {}) as Record<
            string,
            { visitors: number; pageviews: number }
          >,
        });
      })
      .catch((e) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setHiddenContribs({ hiddenKey, contributions: {} });
      });
    return () => ctrl.abort();
  }, [hiddenKey, currentSite, hours]);
  const hiddenContribMap =
    hiddenKey === "" || hiddenContribs?.hiddenKey !== hiddenKey
      ? null
      : hiddenContribs.contributions;

  const withTrend = useMemo(
    () =>
      (articles ?? []).map((a) => {
        const sub = hiddenContribMap?.[a.pagePath];
        const adjustedVisitors = sub
          ? Math.max(0, a.currentVisitors - (sub.visitors || 0))
          : a.currentVisitors;
        const adjustedPageviews = sub
          ? Math.max(0, a.currentPageviews - (sub.pageviews || 0))
          : a.currentPageviews;
        return {
          ...a,
          currentVisitors: adjustedVisitors,
          currentPageviews: adjustedPageviews,
          rawVisitors: a.currentVisitors,
          rawPageviews: a.currentPageviews,
          hiddenSubtracted: sub
            ? { visitors: sub.visitors || 0, pageviews: sub.pageviews || 0 }
            : null,
          trendScore: computeTrendScore(a.snapshots, trendWindowMinutes),
          firstHourGrowth: computeFirstHourGrowth(a.snapshots, a.firstSeenAt),
        };
      }),
    [articles, trendWindowMinutes, hiddenContribMap]
  );

  const filtered = useMemo(() => {
    const needle = filters.article.trim().toLowerCase();
    const firstSeenCutoff = firstSeenCutoffFor(filters.firstSeenWithinHours);
    const sourceAllow =
      sourceFilter && sourcePagePaths?.source === sourceFilter
        ? new Set(sourcePagePaths.pagePaths)
        : null;
    return withTrend.filter((a) => {
      if (needle) {
        const hay = `${a.pagePath} ${a.title ?? ""} ${parseArticleName(
          a.pagePath
        )}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (!applyNumericFilter(a.currentVisitors, filters.visitors)) return false;
      if (!applyNumericFilter(a.currentPageviews, filters.pageviews))
        return false;
      if (!applyNumericFilter(a.trendScore, filters.trend)) return false;
      if (filters.firstHour) {
        const value = a.firstHourGrowth;
        if (value === null) return false;
        if (!applyNumericFilter(value, filters.firstHour)) return false;
      }
      if (firstSeenCutoff !== null) {
        if (new Date(a.firstSeenAt).getTime() < firstSeenCutoff) return false;
      }
      if (sourceAllow) {
        if (!sourceAllow.has(a.pagePath)) return false;
      }
      return true;
    });
  }, [withTrend, filters, sourceFilter, sourcePagePaths]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dirMul = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "article":
          cmp = (a.title ?? parseArticleName(a.pagePath)).localeCompare(
            b.title ?? parseArticleName(b.pagePath)
          );
          break;
        case "visitors":
          cmp = a.currentVisitors - b.currentVisitors;
          break;
        case "pageviews":
          cmp = a.currentPageviews - b.currentPageviews;
          break;
        case "firstSeen":
          cmp =
            new Date(a.firstSeenAt).getTime() -
            new Date(b.firstSeenAt).getTime();
          break;
        case "firstHour":
          cmp =
            (a.firstHourGrowth ?? -Infinity) -
            (b.firstHourGrowth ?? -Infinity);
          break;
        case "trend":
          cmp = a.trendScore - b.trendScore;
          break;
      }
      return cmp * dirMul;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    const list = articles ?? [];
    const visitors = list.reduce((s, a) => s + a.currentVisitors, 0);
    const pageviews = list.reduce((s, a) => s + a.currentPageviews, 0);
    const top = [...list].sort(
      (a, b) => b.currentVisitors - a.currentVisitors
    )[0];
    return { visitors, pageviews, top };
  }, [articles]);

  const hasActiveFilters =
    filters.article !== "" ||
    filters.visitors !== null ||
    filters.pageviews !== null ||
    filters.trend !== null ||
    filters.firstSeenWithinHours !== null ||
    sourceFilter !== null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <SiteSelector sites={sites} current={currentSite} />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Window
            </span>
            <div
              role="radiogroup"
              aria-label="Time window"
              className="flex rounded-lg border border-gray-300 bg-white p-0.5"
            >
              {hourOptions.map((o) => {
                const active = hours === o.value;
                return (
                  <button
                    key={o.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setHours(o.value)}
                    title={`Show articles first seen in the last ${o.label}`}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-600 text-white shadow-sm ring-1 ring-blue-600"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="sm:hidden">{o.short}</span>
                    <span className="hidden sm:inline">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {!enabled && (
          <span className="rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            Monitor disabled{isAdmin ? " — enable at /admin/monitor" : ""}
          </span>
        )}
      </div>

      {!enabled ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Article monitoring is disabled.
          {isAdmin ? (
            <>
              {" "}An admin can enable it from{" "}
              <a
                href="/admin/monitor"
                className="text-blue-600 hover:underline"
              >
                /admin/monitor
              </a>
              .
            </>
          ) : (
            " Ask an admin to turn it on."
          )}
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              label="Articles seen"
              value={(articles ?? []).length.toLocaleString()}
            />
            <MetricCard
              label="Total visitors (today)"
              value={totals.visitors.toLocaleString()}
            />
            <MetricCard
              label="Total pageviews (today)"
              value={totals.pageviews.toLocaleString()}
            />
            <MetricCard
              label="Top article"
              value={
                totals.top ? totals.top.currentVisitors.toLocaleString() : "—"
              }
              secondary={
                totals.top
                  ? totals.top.title ?? parseArticleName(totals.top.pagePath)
                  : ""
              }
            />
          </div>

          <TopSourcesWidget
            site={currentSite}
            hours={hours}
            activeSource={sourceFilter}
            onSelect={setSourceFilter}
            hiddenSources={hiddenSources}
            onHide={hideSource}
            onUnhide={unhideSource}
            onClearHidden={clearHidden}
          />

          {sourceFilter &&
            sourcePagePaths?.source === sourceFilter &&
            (() => {
              const meta = sourcePagePaths.meta;
              const total = sourcePagePaths.pagePaths.length;
              const visibleSet = new Set(
                (articles ?? []).map((a) => a.pagePath)
              );
              const visibleMatches = sourcePagePaths.pagePaths.filter((p) =>
                visibleSet.has(p)
              ).length;
              const hasErr = meta?.plausibleError || meta?.dbError;
              return (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Filtering by source{" "}
                      <strong className="font-semibold">
                        {sourceFilter}
                      </strong>{" "}
                      · Plausible returned {meta?.plausibleCount ?? total}{" "}
                      {typeof meta?.dbCount === "number" && meta.dbCount > 0
                        ? `+ ${meta.dbCount} stored`
                        : ""}
                      {" "}= {total} page{total === 1 ? "" : "s"}, of which{" "}
                      <strong>{visibleMatches}</strong>{" "}
                      {visibleMatches === 1 ? "is" : "are"} in the current
                      window.
                    </span>
                    <button
                      onClick={() => setSourceFilter(null)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  {hasErr && (
                    <p className="mt-1 text-red-700">
                      Error: {meta?.plausibleError ?? meta?.dbError}
                    </p>
                  )}
                  {!hasErr && total === 0 && (
                    <p className="mt-1 text-blue-700">
                      No pages matched this source today. Try a longer window
                      or pick a different source.
                    </p>
                  )}
                  {!hasErr && total > 0 && visibleMatches === 0 && (
                    <p className="mt-1 text-blue-700">
                      The source has visits today, but none of its pages are
                      in the current list (maybe the window is too short, or
                      the regex pattern excludes them).
                    </p>
                  )}
                </div>
              );
            })()}

          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Loading…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                    <SortableHeader
                      label="Article"
                      sortKey="article"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      className="px-5 py-3"
                    />
                    <SortableHeader
                      label="Visitors"
                      sortKey="visitors"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      align="right"
                      className="px-2 py-3"
                    />
                    <SortableHeader
                      label="Pageviews"
                      sortKey="pageviews"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      align="right"
                      className="px-2 py-3"
                    />
                    <SortableHeader
                      label="1h visitors"
                      sortKey="firstHour"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      align="right"
                      className="px-2 py-3"
                    />
                    <SortableHeader
                      label="First seen"
                      sortKey="firstSeen"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      align="right"
                      className="px-5 py-3"
                    />
                    <SortableHeader
                      label="Trend"
                      sortKey="trend"
                      active={sortKey}
                      dir={sortDir}
                      onSort={setSortParam}
                      className="px-5 py-3"
                    />
                  </tr>
                  <MonitorFilters
                    filters={filters}
                    onChange={setFiltersParam}
                  />
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm text-gray-500"
                      >
                        {sourceLoading
                          ? "Resolving source filter…"
                          : hasActiveFilters
                          ? "No articles match the current filters."
                          : `No articles monitored yet for ${currentSite} in the last ${hours}h.`}
                      </td>
                    </tr>
                  ) : (
                    sorted.map((a, i) => {
                      const expanded = expandedPath === a.pagePath;
                      const liveUrl = `${siteBaseUrl}${
                        a.pagePath.startsWith("/") ? a.pagePath : `/${a.pagePath}`
                      }`;
                      const trendLabel = formatTrendScore(a.trendScore);
                      return (
                        <ArticleRow
                          key={a.pagePath}
                          article={a}
                          expanded={expanded}
                          onToggle={() =>
                            setExpandedPath(expanded ? null : a.pagePath)
                          }
                          liveUrl={liveUrl}
                          trendLabel={trendLabel}
                          hours={hours}
                          zebra={i % 2 === 0}
                          sourceTimeseriesEnabled={sourceTimeseriesEnabled}
                          showArticleImages={showArticleImages}
                          authorShortNames={authorShortNames}
                        />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "right";
  className?: string;
}) {
  const isActive = active === sortKey;
  const indicator = isActive ? (dir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex w-full items-center gap-1 font-medium uppercase tracking-wider ${
          align === "right" ? "justify-end" : "justify-start"
        } ${isActive ? "text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
      >
        <span>{label}</span>
        <span className="text-[10px]">{indicator}</span>
      </button>
    </th>
  );
}

function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 2c1 3 4 4.5 4 8a4 4 0 1 1-8 0c0-1.2.3-2.1.8-2.9C9 8.6 10 7 10 5c1 1 2 2 2 3 .7-1 1-3 0-6zm-1.5 14a2.5 2.5 0 0 0 5 0c0-1.1-.6-2-1.4-2.6 0 1-.4 1.6-1.1 2-.2-1-.9-1.8-2-2.4 0 1.5-.5 2-.5 3z" />
    </svg>
  );
}

interface ArticleRowProps {
  article: Article & {
    trendScore: number;
    firstHourGrowth: number | null;
    rawVisitors: number;
    rawPageviews: number;
    hiddenSubtracted: { visitors: number; pageviews: number } | null;
  };
  expanded: boolean;
  onToggle: () => void;
  liveUrl: string;
  trendLabel: string;
  hours: number;
  zebra: boolean;
  sourceTimeseriesEnabled: boolean;
  showArticleImages: boolean;
  authorShortNames: Record<string, string>;
}

function ArticleRow({
  article: a,
  expanded,
  onToggle,
  liveUrl,
  trendLabel,
  hours,
  zebra,
  sourceTimeseriesEnabled,
  showArticleImages,
  authorShortNames,
}: ArticleRowProps) {
  const displayTitle = a.title ?? parseArticleName(a.pagePath);
  const titleSource: "rss" | "path" = a.title ? "rss" : "path";
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors ${
          expanded ? "bg-blue-50/60" : zebra ? "bg-white" : "bg-gray-50/50"
        } hover:bg-blue-50/40`}
      >
        <td
          className="max-w-0 truncate px-5 py-3 text-gray-800"
          title={a.pagePath}
        >
          <div className="flex items-start gap-3">
            {showArticleImages && a.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.imageUrl}
                alt=""
                className="h-10 w-14 shrink-0 rounded object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium" title={displayTitle}>
                  {displayTitle}
                </span>
                {a.hasStoredSources && (
                  <span
                    className="shrink-0 text-orange-500"
                    title="Source history is being recorded for this article (stored per tick)"
                    aria-label="Source sampled"
                  >
                    <FlameIcon />
                  </span>
                )}
                {a.titleChanged && (
                  <span
                    className="shrink-0 text-yellow-500"
                    title="Title has been changed since we first saw this article (click row to see history)"
                    aria-label="Title changed"
                  >
                    <LightbulbIcon />
                  </span>
                )}
                {titleSource === "rss" && (
                  <span
                    className="shrink-0 rounded bg-blue-50 px-1 text-[10px] font-medium uppercase text-blue-600"
                    title="Title sourced from RSS"
                  >
                    RSS
                  </span>
                )}
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={liveUrl}
                  className="shrink-0 text-gray-400 hover:text-blue-600"
                  aria-label="Open live article"
                >
                  <ExternalIcon />
                </a>
              </div>
              <div className="truncate text-xs text-gray-400">{a.pagePath}</div>
              {a.topAuthors.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {a.topAuthors.slice(0, 3).map((au) => {
                    const full = authorShortNames[au.name] ?? au.name;
                    return (
                      <span
                        key={au.name}
                        className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                        title={
                          full === au.name
                            ? `${au.name}: ${au.visitors.toLocaleString()} visitors`
                            : `${au.name} → ${full}: ${au.visitors.toLocaleString()} visitors`
                        }
                      >
                        {full}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </td>
        <td
          className="px-2 py-3 text-right text-base font-semibold tabular-nums text-gray-900"
          title={
            a.hiddenSubtracted
              ? `Original: ${a.rawVisitors.toLocaleString()} · Hidden sources contributed ${a.hiddenSubtracted.visitors.toLocaleString()}`
              : undefined
          }
        >
          {a.currentVisitors.toLocaleString()}
          {a.hiddenSubtracted && a.hiddenSubtracted.visitors > 0 && (
            <span
              className="ml-1 text-[10px] font-normal text-amber-600"
              aria-hidden
            >
              *
            </span>
          )}
        </td>
        <td
          className="px-2 py-3 text-right tabular-nums text-gray-600"
          title={
            a.hiddenSubtracted
              ? `Original: ${a.rawPageviews.toLocaleString()}`
              : undefined
          }
        >
          {a.currentPageviews.toLocaleString()}
          {a.hiddenSubtracted && a.hiddenSubtracted.pageviews > 0 && (
            <span
              className="ml-1 text-[10px] font-normal text-amber-600"
              aria-hidden
            >
              *
            </span>
          )}
        </td>
        <td
          className="px-2 py-3 text-right tabular-nums text-gray-600"
          title={
            a.firstHourGrowth === null
              ? "Not enough history yet (article is less than 1h old)"
              : "Visitors one hour after first detection"
          }
        >
          {a.firstHourGrowth === null ? (
            <span className="text-gray-400">—</span>
          ) : (
            a.firstHourGrowth.toLocaleString()
          )}
        </td>
        <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-gray-500">
          {relTime(a.firstSeenAt)}
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-3">
            <ArticleSparkline snapshots={a.snapshots} />
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                a.trendScore > 0
                  ? "bg-green-50 text-green-700"
                  : a.trendScore < 0
                  ? "bg-red-50 text-red-700"
                  : "bg-gray-100 text-gray-500"
              }`}
              title={`Trend (per minute over last ${Math.round(
                60
              )}m window)`}
            >
              {trendLabel}
            </span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-gray-100">
          <td colSpan={6} className="p-0">
            <ArticleRowDetails
              pagePath={a.pagePath}
              siteId={a.siteId}
              hours={hours}
              snapshots={a.snapshots}
              liveUrl={liveUrl}
              firstSeenAt={a.firstSeenAt}
              lastCheckedAt={a.lastCheckedAt}
              currentVisitors={a.currentVisitors}
              currentPageviews={a.currentPageviews}
              trendLabel={trendLabel}
              firstHourGrowth={a.firstHourGrowth}
              sourceTimeseriesEnabled={sourceTimeseriesEnabled}
              authorShortNames={authorShortNames}
              currentTitle={a.title}
              imageUrl={a.imageUrl}
              showArticleImages={showArticleImages}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function MetricCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {secondary && (
        <p className="truncate text-xs text-gray-500" title={secondary}>
          {secondary}
        </p>
      )}
    </div>
  );
}
