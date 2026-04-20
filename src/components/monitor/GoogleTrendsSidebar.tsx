"use client";

import { useCallback, useEffect, useState } from "react";

interface TrendItem {
  title: string;
  traffic: string | null;
  url: string | null;
  newsTitle?: string | null;
  newsUrl?: string | null;
}

interface Snapshot {
  locale: string;
  fetchedAt: string;
  source: string;
  data: TrendItem[];
  error: string | null;
}

interface Payload {
  enabled: boolean;
  locales: string[];
  snapshots: Snapshot[];
  refreshed?: boolean;
  error?: string;
}

function fmtRel(iso: string): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GoogleTrendsSidebar() {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLocale, setActiveLocale] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/monitor/google-trends")
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d: Payload) => {
        setData(d);
        setError(null);
        if (!activeLocale && d.locales.length > 0) {
          setActiveLocale(d.locales[0]);
        }
      })
      .catch((e) => setError(String(e)));
  }, [activeLocale]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (activeLocale) params.set("locale", activeLocale);
      const res = await fetch(`/api/monitor/google-trends?${params}`, {
        method: "POST",
      });
      const d = (await res.json()) as Payload;
      // Merge: refreshed locales overwrite, others stay.
      setData((prev) => {
        if (!prev) return d;
        const next = { ...prev };
        const map = new Map(prev.snapshots.map((s) => [s.locale, s]));
        for (const s of d.snapshots) map.set(s.locale, s);
        next.snapshots = Array.from(map.values());
        next.locales = prev.locales;
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (!data?.enabled) return null;

  const current = activeLocale
    ? data.snapshots.find((s) => s.locale === activeLocale)
    : data.snapshots[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed right-3 top-1/2 z-30 -translate-y-1/2 rounded-l-md border border-r-0 border-gray-300 bg-white px-2 py-3 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        aria-label={open ? "Hide Google Trends" : "Show Google Trends"}
        title="Google Trends"
      >
        <span className="block writing-mode-vertical-lr [writing-mode:vertical-rl]">
          {open ? "Hide trends ›" : "‹ Trends"}
        </span>
      </button>

      <aside
        className={`fixed right-0 top-0 z-20 h-full w-80 transform border-l border-gray-200 bg-white shadow-xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Google Trends
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex items-center gap-1 border-b border-gray-100 px-4 py-2">
            {data.locales.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setActiveLocale(loc)}
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  loc === activeLocale
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {loc}
              </button>
            ))}
            <div className="ml-auto" />
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Calls scrape.do — counts against your quota"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="px-4 py-2 text-[11px] text-gray-500">
            {current?.fetchedAt ? (
              <>
                Last call: {fmtRel(current.fetchedAt)} ·{" "}
                <span title={current.fetchedAt}>
                  {new Date(current.fetchedAt).toLocaleTimeString()}
                </span>
                {current.source && (
                  <span
                    className="ml-1 text-gray-400"
                    title={
                      current.source === "google-direct"
                        ? "Fetched directly from Google (free)"
                        : "Fetched via scrape.do (paid proxy fallback)"
                    }
                  >
                    · {current.source === "google-direct" ? "direct" : "proxy"}
                  </span>
                )}
              </>
            ) : (
              "No snapshot yet — click Refresh."
            )}
            {current?.error && (
              <span className="ml-1 text-amber-600" title={current.error}>
                · warn
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {error && (
              <p className="text-xs text-red-600">Error: {error}</p>
            )}
            {!current ? (
              <p className="text-xs text-gray-400">No data.</p>
            ) : current.data.length === 0 ? (
              <p className="text-xs text-gray-400">
                {current.error
                  ? `No items (${current.error}).`
                  : "No trending searches yet."}
              </p>
            ) : (
              <ol className="space-y-2.5">
                {current.data.map((t, i) => (
                  <li
                    key={`${t.title}-${i}`}
                    className="rounded border border-gray-100 bg-gray-50/40 p-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-800">
                        {i + 1}. {t.title}
                      </span>
                      {t.traffic && (
                        <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {t.traffic}
                        </span>
                      )}
                    </div>
                    {t.newsTitle && (
                      <a
                        href={t.newsUrl ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 line-clamp-2 block text-[11px] text-gray-500 hover:text-blue-600 hover:underline"
                      >
                        {t.newsTitle}
                      </a>
                    )}
                    {t.url && (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[10px] text-blue-600 hover:underline"
                      >
                        Trends ↗
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
