"use client";

import { useEffect, useState } from "react";
import ArticleSparkline from "./ArticleSparkline";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews: number | null;
}

interface SourceRow {
  source: string;
  visitors: number;
}

interface SourcesPayload {
  pagePath: string;
  source: "db" | "plausible" | "error";
  sources: SourceRow[];
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
}: Props) {
  const [state, setState] = useState<{
    deps: string;
    data: SourcesPayload | null;
    error: string | null;
  }>({ deps: "", data: null, error: null });

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

  const currentDeps = state.deps === deps ? state : null;
  const data = currentDeps?.data ?? null;
  const error = currentDeps?.error ?? null;
  const loading = currentDeps === null;

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
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <ArticleSparkline snapshots={snapshots} size="lg" />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-4">
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
      </div>
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
    </div>
  );
}
