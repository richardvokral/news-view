"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ArticleSparkline from "./ArticleSparkline";
import SiteSelector from "@/components/reports/SiteSelector";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews: number | null;
}

interface Article {
  pagePath: string;
  siteId: string;
  firstSeenAt: string;
  currentVisitors: number;
  currentPageviews: number;
  snapshots: Snapshot[];
}

interface Props {
  sites: string[];
  currentSite: string;
  defaultHours: number;
  enabled: boolean;
  isAdmin: boolean;
}

const HOUR_OPTIONS = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 72, label: "3d" },
];

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

export default function MonitorDashboard({
  sites,
  currentSite,
  defaultHours,
  enabled,
  isAdmin,
}: Props) {
  const [hours, setHours] = useState(defaultHours);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [currentSite, hours, enabled]);

  useEffect(() => {
    setLoading(true);
    fetchArticles();
    if (!enabled) return;
    const interval = setInterval(fetchArticles, 60_000);
    return () => clearInterval(interval);
  }, [fetchArticles, enabled]);

  const sorted = useMemo(
    () => [...articles].sort((a, b) => b.currentVisitors - a.currentVisitors),
    [articles]
  );

  const totals = useMemo(() => {
    const visitors = articles.reduce((s, a) => s + a.currentVisitors, 0);
    const pageviews = articles.reduce((s, a) => s + a.currentPageviews, 0);
    return { visitors, pageviews, top: sorted[0] };
  }, [articles, sorted]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <SiteSelector sites={sites} current={currentSite} />
          <div className="flex rounded-lg border border-gray-300 bg-white p-0.5">
            {HOUR_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setHours(o.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  hours === o.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {o.label}
              </button>
            ))}
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
              value={articles.length.toLocaleString()}
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
                totals.top ? parseArticleName(totals.top.pagePath) : ""
              }
            />
          </div>

          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Loading…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          ) : sorted.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              No articles monitored yet for {currentSite} in the last {hours}h.
              The next cron tick will populate this.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-5 py-3">Article</th>
                    <th className="px-2 py-3 text-right">Visitors</th>
                    <th className="px-2 py-3 text-right">Pageviews</th>
                    <th className="px-5 py-3 text-right">First seen</th>
                    <th className="px-5 py-3">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((a, i) => (
                    <tr
                      key={a.pagePath}
                      className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}
                    >
                      <td
                        className="max-w-0 truncate px-5 py-3 text-gray-800"
                        title={a.pagePath}
                      >
                        <div className="font-medium">
                          {parseArticleName(a.pagePath)}
                        </div>
                        <div className="truncate text-xs text-gray-400">
                          {a.pagePath}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right text-base font-semibold tabular-nums text-gray-900">
                        {a.currentVisitors.toLocaleString()}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-gray-600">
                        {a.currentPageviews.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-gray-500">
                        {relTime(a.firstSeenAt)}
                      </td>
                      <td className="px-5 py-3">
                        <ArticleSparkline snapshots={a.snapshots} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
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
