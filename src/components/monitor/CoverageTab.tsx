"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface UncoveredRow {
  externalId: number;
  feedSource: string;
  title: string;
  link: string;
  pubDate: string | null;
  importance: number;
  rationale: string | null;
  analyzedAt: string;
}

interface CoveredMatch {
  externalId: number;
  feedSource: string;
  title: string;
  link: string;
  pubDate: string | null;
  importance: number;
}

interface CoveredRow {
  ourPath: string;
  ourTitle: string;
  ourFirstSeenAt: string | null;
  ourPubDate: string | null;
  matches: CoveredMatch[];
  matchCount: number;
  maxImportance: number;
}

interface CoveragePayload {
  site: string;
  windowHours: number;
  totalExternals: number;
  analysed: number;
  uncovered: UncoveredRow[];
  covered: CoveredRow[];
  enabled: boolean;
  externalRssEnabled: boolean;
  feeds: string[];
  error?: string;
}

interface Props {
  site: string;
  siteBaseUrl: string;
  isAdmin: boolean;
}

const PAGE_SIZE = 10;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ImportanceBadge({ value }: { value: number }) {
  const capped = Math.max(1, Math.min(5, value));
  const color =
    capped >= 5
      ? "bg-red-100 text-red-800 border-red-300"
      : capped >= 4
      ? "bg-orange-100 text-orange-800 border-orange-300"
      : capped >= 3
      ? "bg-amber-100 text-amber-800 border-amber-300"
      : capped >= 2
      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
      : "bg-gray-100 text-gray-700 border-gray-300";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${color}`}
      title={`Importance ${capped}/5`}
    >
      {capped}/5
    </span>
  );
}

export default function CoverageTab({ site, siteBaseUrl, isAdmin }: Props) {
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [uncoveredPage, setUncoveredPage] = useState(0);
  const [coveredPage, setCoveredPage] = useState(0);

  const load = useCallback(() => {
    if (!site) return;
    const params = new URLSearchParams({ site });
    fetch(`/api/monitor/coverage?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        setData(d as CoveragePayload);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [site]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  const runNow = async () => {
    if (!site) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch(
        `/api/admin/coverage-run?site=${encodeURIComponent(site)}`,
        { method: "POST" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const summary = (d.sites as Array<{
        siteId?: string;
        skippedReason?: string;
        analysed?: number;
        covered?: number;
        uncovered?: number;
        errors?: number;
        ingest?: Array<{ feedSource: string; inserted: number; error?: string }>;
      }> | undefined)?.[0];
      if (summary?.skippedReason) {
        setRunMsg(`Skipped: ${summary.skippedReason}`);
      } else if (summary) {
        const ingested =
          summary.ingest?.reduce((s, f) => s + (f.inserted ?? 0), 0) ?? 0;
        setRunMsg(
          `Ingested ${ingested} new externals · analysed ${
            summary.analysed ?? 0
          } · covered ${summary.covered ?? 0} / uncovered ${
            summary.uncovered ?? 0
          }${
            summary.errors ? ` · ${summary.errors} errors` : ""
          }`
        );
      } else {
        setRunMsg("Done.");
      }
      load();
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const uncovered = useMemo(() => data?.uncovered ?? [], [data]);
  const covered = useMemo(() => data?.covered ?? [], [data]);

  const uncoveredPages = Math.max(1, Math.ceil(uncovered.length / PAGE_SIZE));
  const coveredPages = Math.max(1, Math.ceil(covered.length / PAGE_SIZE));
  const uncoveredSlice = useMemo(
    () => uncovered.slice(uncoveredPage * PAGE_SIZE, (uncoveredPage + 1) * PAGE_SIZE),
    [uncovered, uncoveredPage]
  );
  const coveredSlice = useMemo(
    () => covered.slice(coveredPage * PAGE_SIZE, (coveredPage + 1) * PAGE_SIZE),
    [covered, coveredPage]
  );

  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        {error ? `Error: ${error}` : "Loading…"}
      </div>
    );
  }

  if (!data.externalRssEnabled && !data.enabled) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        Coverage analysis is disabled.
        {isAdmin ? (
          <>
            {" "}Enable it from{" "}
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
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Coverage comparison
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Window {data.windowHours}h · {data.totalExternals} external
              article{data.totalExternals === 1 ? "" : "s"} · {data.analysed}{" "}
              analysed · {uncovered.length} uncovered, {covered.length} covered
              buckets · feeds: {data.feeds.length > 0 ? data.feeds.join(", ") : "(none)"}
            </p>
            {data.error && (
              <p className="mt-1 text-xs text-red-600">Error: {data.error}</p>
            )}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3">
              {runMsg && (
                <span className="text-xs text-gray-600">{runMsg}</span>
              )}
              <button
                type="button"
                onClick={runNow}
                disabled={running}
                className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {running ? "Running…" : "Fetch + analyse now"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              Uncovered topics
            </h3>
            <p className="text-xs text-gray-500">
              External stories none of our articles cover (sorted by importance).
            </p>
          </div>
          <Pagination
            page={uncoveredPage}
            pageCount={uncoveredPages}
            onPage={setUncoveredPage}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-2 w-16">Imp.</th>
              <th className="px-2 py-2">Headline</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-5 py-2 text-right">Published</th>
            </tr>
          </thead>
          <tbody>
            {uncoveredSlice.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-10 text-center text-sm text-gray-400"
                >
                  {uncovered.length === 0
                    ? "No uncovered topics — we're keeping up with the external feeds in this window."
                    : "No rows on this page."}
                </td>
              </tr>
            ) : (
              uncoveredSlice.map((row) => (
                <tr key={row.externalId} className="border-b border-gray-50">
                  <td className="px-5 py-2">
                    <ImportanceBadge value={row.importance} />
                  </td>
                  <td className="px-2 py-2">
                    <a
                      href={row.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-800 hover:text-blue-600 hover:underline"
                      title={row.rationale ?? undefined}
                    >
                      {row.title}
                    </a>
                    {row.rationale && (
                      <div className="text-xs italic text-gray-500">
                        {row.rationale}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-500">
                    {row.feedSource}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 text-right text-xs text-gray-500">
                    {fmtDate(row.pubDate)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              Covered topics
            </h3>
            <p className="text-xs text-gray-500">
              Our articles that the AI matched to external stories (up to 3 per bucket).
            </p>
          </div>
          <Pagination
            page={coveredPage}
            pageCount={coveredPages}
            onPage={setCoveredPage}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-2">Our article</th>
              <th className="px-2 py-2">Matched external headlines</th>
            </tr>
          </thead>
          <tbody>
            {coveredSlice.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="px-5 py-10 text-center text-sm text-gray-400"
                >
                  {covered.length === 0
                    ? "No covered buckets yet — nothing to show."
                    : "No rows on this page."}
                </td>
              </tr>
            ) : (
              coveredSlice.map((row) => {
                const ourLink = `${siteBaseUrl}${row.ourPath}`;
                const ourWhen = row.ourPubDate ?? row.ourFirstSeenAt;
                const ourWhenSource: "rss" | "detected" | null = row.ourPubDate
                  ? "rss"
                  : row.ourFirstSeenAt
                  ? "detected"
                  : null;
                return (
                  <tr key={row.ourPath} className="border-b border-gray-50 align-top">
                    <td className="max-w-[28rem] px-5 py-2">
                      <a
                        href={ourLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-800 hover:text-blue-600 hover:underline"
                      >
                        {row.ourTitle}
                      </a>
                      {ourWhen && (
                        <div
                          className="mt-0.5 text-[10px] text-gray-500"
                          title={
                            ourWhenSource === "rss"
                              ? `Published on our RSS at ${ourWhen}`
                              : `First detected in Plausible at ${ourWhen}`
                          }
                        >
                          {ourWhenSource === "rss" ? "Published " : "First seen "}
                          {fmtDate(ourWhen)}
                          {ourWhenSource === "detected" && (
                            <span className="ml-1 text-gray-400">
                              (no RSS pub date)
                            </span>
                          )}
                        </div>
                      )}
                      <div className="truncate text-[10px] text-gray-400">
                        {row.ourPath}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <ul className="space-y-1">
                        {row.matches.map((m) => (
                          <li
                            key={m.externalId}
                            className="flex items-start gap-2 text-xs"
                          >
                            <ImportanceBadge value={m.importance} />
                            <a
                              href={m.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-gray-700 hover:text-blue-600 hover:underline"
                            >
                              {m.title}
                            </a>
                            <span className="whitespace-nowrap text-[10px] text-gray-400">
                              {m.feedSource} · {fmtDate(m.pubDate)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="tabular-nums text-gray-500">
        {page + 1} / {pageCount}
      </span>
      <button
        onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
        disabled={page >= pageCount - 1}
        className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}
