"use client";

import { useEffect, useState } from "react";

interface SourceRow {
  source: string;
  visitors: number;
}

interface Props {
  site: string;
  hours: number;
  activeSource: string | null;
  onSelect: (source: string | null) => void;
  hiddenSources: string[];
  onHide: (source: string) => void;
  onUnhide: (source: string) => void;
  onClearHidden: () => void;
}

function matchesHidden(source: string, hidden: string[]): boolean {
  if (hidden.length === 0) return false;
  const needle = source.toLowerCase();
  return hidden.some((h) => {
    const pat = h.trim().toLowerCase();
    return pat.length > 0 && needle.includes(pat);
  });
}

interface Meta {
  rawCount: number;
  excludedCount: number;
  adminExcluded: string[];
  error: string | null;
  fetchedAt: string;
  site: string;
  hours: number;
}

export default function TopSourcesWidget({
  site,
  hours,
  activeSource,
  onSelect,
  hiddenSources,
  onHide,
  onUnhide,
  onClearHidden,
}: Props) {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site) return;
    let cancelled = false;
    const load = () => {
      const params = new URLSearchParams({ site, hours: String(hours) });
      fetch(`/api/monitor/sources?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
        .then((data) => {
          if (cancelled) return;
          setSources((data.sources || []) as SourceRow[]);
          setMeta((data.meta ?? null) as Meta | null);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(String(e));
        });
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [site, hours]);

  const loading = sources === null && error === null;

  const list = sources ?? [];
  const visible = list.filter((s) => !matchesHidden(s.source, hiddenSources));
  const max = visible[0]?.visitors || 1;
  const shown = visible;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Top sources</h2>
        <div className="flex items-center gap-3 text-xs">
          {hiddenSources.length > 0 && (
            <button
              onClick={onClearHidden}
              className="font-medium text-gray-500 hover:underline"
              title="Show all hidden sources again"
            >
              Unhide all ({hiddenSources.length})
            </button>
          )}
          {activeSource && (
            <button
              onClick={() => onSelect(null)}
              className="font-medium text-blue-600 hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : shown.length === 0 ? (
        <div className="space-y-1 text-xs text-gray-500">
          {list.length === 0 ? (
            <>
              {meta?.error ? (
                <p className="text-red-600">
                  Plausible error: {meta.error}
                </p>
              ) : meta && meta.rawCount === 0 ? (
                <p>
                  Plausible returned 0 sources for <code>{meta.site}</code> on
                  today&rsquo;s window. Either the site has no traffic yet today
                  or the site id doesn&rsquo;t match.
                </p>
              ) : meta && meta.excludedCount > 0 ? (
                <p>
                  All {meta.rawCount} returned sources were filtered by the
                  admin <code>excluded_sources</code> list (
                  {meta.adminExcluded.join(", ")}).
                </p>
              ) : (
                <p>No source data yet.</p>
              )}
              {meta && (
                <p className="text-[10px] text-gray-400">
                  Last checked {new Date(meta.fetchedAt).toLocaleTimeString()} ·
                  raw={meta.rawCount} excluded={meta.excludedCount}
                </p>
              )}
            </>
          ) : (
            <p>All sources are hidden in this session.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shown.map((s) => {
            const active = activeSource === s.source;
            const pct = Math.max(4, Math.round((s.visitors / max) * 100));
            return (
              <div
                key={s.source}
                className={`group relative flex items-stretch overflow-hidden rounded-md border text-xs font-medium transition ${
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                }`}
              >
                <button
                  onClick={() => onSelect(active ? null : s.source)}
                  className="relative flex-1 overflow-hidden px-3 py-1.5"
                  title={`${s.source}: ${s.visitors.toLocaleString()} visitors`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 ${
                      active ? "bg-blue-100" : "bg-gray-200/50"
                    }`}
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                  <span className="relative flex items-center gap-2">
                    <span className="max-w-[10rem] truncate">{s.source}</span>
                    <span className="tabular-nums text-gray-500">
                      {s.visitors.toLocaleString()}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onHide(s.source)}
                  title="Hide from this view"
                  aria-label={`Hide ${s.source}`}
                  className="flex items-center px-2 text-gray-400 hover:bg-gray-200/60 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {hiddenSources.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-[11px]">
          <p className="text-gray-500">
            Visitor and pageview counts with a{" "}
            <span className="font-semibold text-amber-600">*</span> in the table
            below have had the hidden sources subtracted.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase text-gray-400">Hidden:</span>
            {hiddenSources.map((s) => (
              <button
                key={s}
                onClick={() => onUnhide(s)}
                className="rounded border border-dashed border-gray-300 px-2 py-0.5 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                title="Click to show again"
              >
                {s} ↺
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
