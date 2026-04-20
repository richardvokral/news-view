"use client";

import { useEffect, useState } from "react";
import ArticleSparkline from "./ArticleSparkline";
import ArticleSourceTimeseriesChart from "./ArticleSourceTimeseriesChart";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews: number | null;
}

interface SourceRow {
  source: string;
  visitors: number;
}

interface TimeseriesPoint {
  capturedAt: string;
  values: Record<string, number>;
}

interface SourcesPayload {
  pagePath: string;
  source: "db" | "plausible" | "error";
  sources: SourceRow[];
  topSources?: string[];
  timeseries?: TimeseriesPoint[];
}

interface TitleHistoryEntry {
  capturedAt: string;
  title: string;
  imageUrl: string | null;
}

interface TitleHistoryPayload {
  pagePath: string;
  history: TitleHistoryEntry[];
}

interface AuthorRow {
  name: string;
  visitors: number;
}

interface AuthorsPayload {
  site: string;
  pagePath: string | null;
  authors: AuthorRow[];
  error?: string;
}

interface Props {
  pagePath: string;
  siteId: string;
  hours: number;
  snapshots: Snapshot[];
  liveUrl: string;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  currentVisitors: number;
  currentPageviews: number;
  trendLabel: string;
  firstHourGrowth: number | null;
  sourceTimeseriesEnabled: boolean;
  authorShortNames: Record<string, string>;
  currentTitle: string | null;
  imageUrl: string | null;
  showArticleImages: boolean;
}

function resolveAuthor(
  name: string,
  shortNames: Record<string, string>
): { display: string; full: string; tooltip: string } {
  const full = shortNames[name];
  if (full) return { display: full, full, tooltip: `${name} → ${full}` };
  return { display: name, full: name, tooltip: name };
}

export default function ArticleRowDetails({
  pagePath,
  siteId,
  hours,
  snapshots,
  liveUrl,
  firstSeenAt,
  lastCheckedAt,
  currentVisitors,
  currentPageviews,
  trendLabel,
  firstHourGrowth,
  sourceTimeseriesEnabled,
  authorShortNames,
  currentTitle,
  imageUrl,
  showArticleImages,
}: Props) {
  const [state, setState] = useState<{
    deps: string;
    data: SourcesPayload | null;
    error: string | null;
  }>({ deps: "", data: null, error: null });

  const [titles, setTitles] = useState<{
    deps: string;
    history: TitleHistoryEntry[];
  }>({ deps: "", history: [] });

  const [authors, setAuthors] = useState<{
    deps: string;
    data: AuthorsPayload | null;
  }>({ deps: "", data: null });

  const deps = `${siteId}|${hours}|${pagePath}`;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      site: siteId,
      hours: String(hours),
      path: pagePath,
    });
    fetch(`/api/monitor/article-sources?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        setState({ deps, data: d as SourcesPayload, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ deps, data: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath, siteId, hours, deps]);

  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams({ path: pagePath });
    fetch(`/api/monitor/article-titles?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        const payload = d as TitleHistoryPayload;
        setTitles({ deps, history: payload.history ?? [] });
      })
      .catch(() => {
        if (cancelled) return;
        setTitles({ deps, history: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath, deps]);

  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams({
      site: siteId,
      hours: String(hours),
      path: pagePath,
    });
    fetch(`/api/monitor/authors?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        setAuthors({ deps, data: d as AuthorsPayload });
      })
      .catch(() => {
        if (cancelled) return;
        setAuthors({
          deps,
          data: { site: siteId, pagePath, authors: [], error: "fetch_failed" },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath, siteId, hours, deps]);

  const currentDeps = state.deps === deps ? state : null;
  const data = currentDeps?.data ?? null;
  const error = currentDeps?.error ?? null;
  const loading = currentDeps === null;

  const titleHistory = titles.deps === deps ? titles.history : [];
  const titleHistoryReady = titles.deps === deps;
  const authorsPayload = authors.deps === deps ? authors.data : null;
  const authorsReady = authors.deps === deps;
  const authorRows = authorsPayload?.authors ?? [];
  const authorMax = authorRows[0]?.visitors || 1;

  const sources = data?.sources ?? [];
  const max = sources[0]?.visitors || 1;

  return (
    <div className="grid gap-6 bg-gray-50/60 p-5 md:grid-cols-3">
      <div className="md:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-gray-500">
            Visitors over time
          </h3>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Open live article ↗
          </a>
        </div>
        {showArticleImages && imageUrl && (
          <div className="mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={currentTitle ?? ""}
              className="max-h-40 rounded-lg border border-gray-200 object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <ArticleSparkline snapshots={snapshots} size="lg" />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-5">
          <div>
            <dt className="text-[10px] uppercase text-gray-400">Visitors</dt>
            <dd className="font-semibold text-gray-800">
              {currentVisitors.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-gray-400">Pageviews</dt>
            <dd className="font-semibold text-gray-800">
              {currentPageviews.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-gray-400">Trend</dt>
            <dd className="font-semibold text-gray-800">{trendLabel}</dd>
          </div>
          <div>
            <dt
              className="text-[10px] uppercase text-gray-400"
              title="Visitors recorded one hour after the article was first detected"
            >
              1h visitors
            </dt>
            <dd className="font-semibold text-gray-800">
              {firstHourGrowth === null
                ? "—"
                : firstHourGrowth.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-gray-400">First seen</dt>
            <dd
              className="truncate font-medium text-gray-700"
              title={firstSeenAt}
            >
              {new Date(firstSeenAt).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              })}
            </dd>
          </div>
        </dl>
        {lastCheckedAt && (
          <p className="mt-1 text-[11px] text-gray-400">
            Last checked: {new Date(lastCheckedAt).toLocaleString()}
          </p>
        )}

        {titleHistory.length > 1 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              Title history
            </h3>
            <ol className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-3">
              {titleHistory.map((h, i) => (
                <li
                  key={`${h.capturedAt}-${i}`}
                  className={`flex items-start gap-3 text-xs ${
                    i === titleHistory.length - 1
                      ? "text-gray-800"
                      : "text-gray-500"
                  }`}
                >
                  <span className="shrink-0 tabular-nums text-[10px] uppercase text-gray-400">
                    {new Date(h.capturedAt).toLocaleString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span
                    className={
                      i === titleHistory.length - 1
                        ? "font-medium"
                        : "line-through decoration-gray-300"
                    }
                  >
                    {h.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {titleHistoryReady &&
          titleHistory.length <= 1 &&
          currentTitle === null && (
            <p className="mt-3 text-[11px] text-gray-400">
              No RSS title recorded for this article (falling back to the path-derived name).
            </p>
          )}

        {sourceTimeseriesEnabled && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              Top sources over time
            </h3>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-xs text-gray-400">
                  Loading…
                </div>
              ) : (
                <ArticleSourceTimeseriesChart
                  points={data?.timeseries ?? []}
                  topSources={data?.topSources ?? []}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase text-gray-500">
              Sources
            </h3>
            {data?.source === "db" && (
              <span className="text-[10px] uppercase text-gray-400">stored</span>
            )}
            {data?.source === "plausible" && (
              <span className="text-[10px] uppercase text-gray-400">live</span>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            {loading ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : sources.length === 0 ? (
              <p className="text-xs text-gray-400">No source data.</p>
            ) : (
              <ul className="space-y-1.5">
                {sources.map((s) => {
                  const pct = Math.max(2, Math.round((s.visitors / max) * 100));
                  return (
                    <li key={s.source} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span
                          className="max-w-[70%] truncate text-gray-700"
                          title={s.source}
                        >
                          {s.source}
                        </span>
                        <span className="tabular-nums text-gray-500">
                          {s.visitors.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded bg-gray-100">
                        <div
                          className="h-full bg-blue-400/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase text-gray-500">
              Authors
            </h3>
            {authorsPayload?.error && (
              <span className="text-[10px] uppercase text-amber-600">
                unavailable
              </span>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            {!authorsReady ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : authorRows.length === 0 ? (
              <p className="text-xs text-gray-400">
                No author events recorded for this article.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {authorRows.map((a) => {
                  const resolved = resolveAuthor(a.name, authorShortNames);
                  const pct = Math.max(
                    2,
                    Math.round((a.visitors / authorMax) * 100)
                  );
                  return (
                    <li key={a.name} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span
                          className="max-w-[70%] truncate text-gray-700"
                          title={resolved.tooltip}
                        >
                          {resolved.display}
                          {resolved.display !== a.name && (
                            <span className="ml-1 text-[10px] text-gray-400">
                              ({a.name})
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-gray-500">
                          {a.visitors.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded bg-gray-100">
                        <div
                          className="h-full bg-emerald-400/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
