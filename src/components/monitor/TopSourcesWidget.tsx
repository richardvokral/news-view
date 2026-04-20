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
}

export default function TopSourcesWidget({
  site,
  hours,
  activeSource,
  onSelect,
}: Props) {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
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
  const max = list[0]?.visitors || 1;
  const shown = list.slice(0, 10);

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Top sources</h2>
        {activeSource && (
          <button
            onClick={() => onSelect(null)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-gray-400">No source data yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shown.map((s) => {
            const active = activeSource === s.source;
            const pct = Math.max(4, Math.round((s.visitors / max) * 100));
            return (
              <button
                key={s.source}
                onClick={() => onSelect(active ? null : s.source)}
                className={`group relative overflow-hidden rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                }`}
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
                  {active && <span aria-hidden>×</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
