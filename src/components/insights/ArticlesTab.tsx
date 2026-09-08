"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FetchPanel from "./FetchPanel";

interface ArticleRow {
  pagePath: string;
  headline: string;
  headlineSource: "title" | "slug";
  sections: string[];
  pageviews: number;
  visitorsSum: number;
  bounceRate: number | null;
  visitDuration: number | null;
  firstWeek: string;
  lastWeek: string;
  weeksActive: number;
}

function weekOffset(weeks: number): string {
  const d = new Date();
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift - weeks * 7);
  return d.toISOString().slice(0, 10);
}

const fmt = new Intl.NumberFormat("cs-CZ");

export default function ArticlesTab({
  site,
  backfillWeeks,
  weeksPerRequest,
}: {
  site: string;
  backfillWeeks: number;
  weeksPerRequest: number;
}) {
  const [rows, setRows] = useState<ArticleRow[] | null>(null);
  const [knownSections, setKnownSections] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [section, setSection] = useState("");
  const [rankBy, setRankBy] = useState<"pageviews" | "visitors">("pageviews");

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({
      site,
      from: weekOffset(weeks),
      to: weekOffset(0),
      rankBy,
      limit: "200",
    });
    if (section) params.set("sections", section);
    try {
      const res = await fetch(`/api/insights/articles?${params}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRows(data.articles ?? []);
      setKnownSections(data.knownSections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    }
  }, [site, weeks, section, rankBy]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    if (!rows) return { pageviews: 0, articles: 0 };
    return {
      pageviews: rows.reduce((s, r) => s + r.pageviews, 0),
      articles: rows.length,
    };
  }, [rows]);

  const hasEngagement = useMemo(
    () => (rows ?? []).some((r) => r.bounceRate !== null),
    [rows]
  );

  return (
    <div>
      <FetchPanel
        site={site}
        weeksPerRequest={weeksPerRequest}
        onLoaded={load}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
            Období
          </span>
          <select
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {[4, 8, 12, 26, Math.max(52, backfillWeeks)].map((w) => (
              <option key={w} value={w}>
                Posledních {w} týdnů
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
            Rubrika
          </span>
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Všechny</option>
            {knownSections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
            Řadit podle
          </span>
          <select
            value={rankBy}
            onChange={(e) =>
              setRankBy(e.target.value === "visitors" ? "visitors" : "pageviews")
            }
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="pageviews">Zobrazení</option>
            <option value="visitors">Návštěvníci (součet)</option>
          </select>
        </label>

        <div className="ml-auto text-xs text-gray-500">
          {fmt.format(totals.articles)} článků ·{" "}
          {fmt.format(totals.pageviews)} zobrazení
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Titulek</th>
              <th className="px-3 py-2 text-left font-medium">Rubriky</th>
              <th className="px-3 py-2 text-right font-medium">Zobrazení</th>
              <th className="px-3 py-2 text-right font-medium" title="Součet týdenních unikátů — nadhodnocuje skutečné unikáty">
                Návštěvníci*
              </th>
              {hasEngagement && (
                <th className="px-3 py-2 text-right font-medium">Bounce</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Týdnů</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows === null && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  Načítám…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  Žádná data pro zvolené období. Načtěte je tlačítkem výše.
                </td>
              </tr>
            )}
            {rows?.map((r, i) => (
              <tr key={r.pagePath} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <span className="text-gray-900">{r.headline}</span>
                  {r.headlineSource === "slug" && (
                    <span
                      className="ml-1.5 text-xs text-gray-400"
                      title="Odvozeno z URL — bez diakritiky"
                    >
                      ~
                    </span>
                  )}
                  <div className="font-mono text-xs text-gray-400">
                    {r.pagePath}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {r.sections.join(" / ") || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                  {fmt.format(r.pageviews)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                  {fmt.format(r.visitorsSum)}
                </td>
                {hasEngagement && (
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {r.bounceRate === null ? "—" : `${Math.round(r.bounceRate)}%`}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                  {r.weeksActive}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        * Součet týdenních unikátních návštěvníků. Čtenář aktivní ve třech
        týdnech se započítá třikrát — pro porovnávání používejte zobrazení.
      </p>
    </div>
  );
}
