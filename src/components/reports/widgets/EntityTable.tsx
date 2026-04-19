"use client";

import { useEffect, useState } from "react";
import type { EntityBreakdownWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface EntityRow {
  rawValue: string;
  label: string;
  url: string;
  total: number;
  events: number;
}

function parseArticleSlug(slug: string): string {
  const lastDot = slug.lastIndexOf(".");
  const withoutId =
    lastDot > 0 && /^\d+$/.test(slug.slice(lastDot + 1))
      ? slug.slice(0, lastDot)
      : slug;
  return withoutId.replace(/-/g, " ");
}

interface Props {
  config: EntityBreakdownWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

export default function EntityTable({ config, dateRange, siteId }: Props) {
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isComputed = !!config.computed;
  const displayLimit = config.limit || 10;
  const propKey = config.property.split(":").pop() || config.property;

  function formatLabel(raw: string): string {
    if (config.formatLabel === "article") return parseArticleSlug(raw);
    return raw;
  }

  useEffect(() => {
    setLoading(true);
    setError("");
    const basePeriod =
      dateRange.period === "custom" ? "custom" : dateRange.period;
    if (isComputed) fetchComputed(basePeriod);
    else fetchSimple(basePeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, dateRange, siteId]);

  function fetchSimple(period: string) {
    const params = new URLSearchParams({
      endpoint: "breakdown",
      property: config.property,
      metrics: config.metric,
      period,
      limit: String(displayLimit),
      site: siteId,
    });
    if (dateRange.date) params.set("date", dateRange.date);
    const f = filtersToString(config.filters);
    if (f) params.set("filters", f);

    fetch(`/api/plausible?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((json) => {
        const results: Record<string, string | number>[] = json.results || [];
        const entities = results.slice(0, displayLimit).map((r) => {
          const raw = String(r[propKey]);
          const count = Number(r[config.metric]) || 0;
          return {
            rawValue: raw,
            label: formatLabel(raw),
            url: `${config.baseUrl}/${raw}`,
            total: count,
            events: count,
          };
        });
        setRows(entities);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function fetchComputed(period: string) {
    const dim = config.computed!.dimension;
    const dimKey = dim.split(":").pop() || dim;

    const breakdownParams = new URLSearchParams({
      endpoint: "breakdown",
      property: dim,
      metrics: config.metric,
      period,
      limit: "100",
      site: siteId,
    });
    if (dateRange.date) breakdownParams.set("date", dateRange.date);
    const bf = filtersToString(config.filters);
    if (bf) breakdownParams.set("filters", bf);

    fetch(`/api/plausible?${breakdownParams}`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((breakdownData) => {
        const bRows: Record<string, string | number>[] =
          breakdownData.results || [];
        const uniqueValues = bRows
          .map((r) => String(r[dimKey]))
          .filter((v) => !isNaN(Number(v)) && Number(v) !== 0);
        if (uniqueValues.length === 0) {
          setRows([]);
          setLoading(false);
          return;
        }
        return Promise.all(
          uniqueValues.map(async (val) => {
            const extraFilter: [string, string, string[]][] = [
              ["is", dim, [val]],
            ];
            const combined = [...(config.filters || []), ...extraFilter];
            const params = new URLSearchParams({
              endpoint: "breakdown",
              property: config.property,
              metrics: config.metric,
              period,
              limit: "100",
              site: siteId,
            });
            if (dateRange.date) params.set("date", dateRange.date);
            const f = filtersToString(combined);
            if (f) params.set("filters", f);
            const res = await fetch(`/api/plausible?${params}`);
            if (!res.ok) throw new Error("API error");
            const json = await res.json();
            return {
              value: Number(val),
              entities: (json.results || []) as Record<string, string | number>[],
            };
          })
        ).then((seriesResults) => {
          const byEntity: Record<string, { total: number; events: number }> = {};
          for (const { value, entities } of seriesResults) {
            for (const row of entities) {
              const raw = String(row[propKey]);
              if (!byEntity[raw]) byEntity[raw] = { total: 0, events: 0 };
              const count = Number(row[config.metric]) || 0;
              byEntity[raw].total += value * count;
              byEntity[raw].events += count;
            }
          }
          const sorted: EntityRow[] = Object.entries(byEntity)
            .map(([raw, vals]) => ({
              rawValue: raw,
              label: formatLabel(raw),
              url: `${config.baseUrl}/${raw}`,
              total: vals.total,
              events: vals.events,
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, displayLimit);
          setRows(sorted);
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{config.title}</h3>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No data</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-400">
              <th className="pb-2 pr-2">
                {config.formatLabel === "article" ? "Article" : "ID"}
              </th>
              {isComputed && (
                <th className="w-20 px-2 pb-2 text-right">Total</th>
              )}
              <th className="w-20 px-2 pb-2 text-right">
                {isComputed ? "Events" : "Count"}
              </th>
              <th className="w-10 pb-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.rawValue}
                className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}
              >
                <td
                  className="max-w-0 truncate py-2 pr-2 text-gray-700"
                  title={row.label}
                >
                  {row.label}
                </td>
                {isComputed && (
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-gray-900">
                    {row.total.toLocaleString()}
                  </td>
                )}
                <td className="px-2 py-2 text-right font-medium tabular-nums text-gray-900">
                  {row.events.toLocaleString()}
                </td>
                <td className="py-2 pl-2 text-right">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    title="Open"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.25-.75a.75.75 0 01.75-.75h3.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V6.31l-5.47 5.47a.75.75 0 01-1.06-1.06l5.47-5.47H12.25a.75.75 0 01-.75-.75z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
