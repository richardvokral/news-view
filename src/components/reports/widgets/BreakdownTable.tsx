"use client";

import { useEffect, useState } from "react";
import type { BreakdownWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface BreakdownRow {
  [key: string]: string | number;
}

interface Props {
  config: BreakdownWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

export default function BreakdownTable({ config, dateRange, siteId }: Props) {
  const [data, setData] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      endpoint: "breakdown",
      property: config.dimension,
      metrics: config.metric,
      period: dateRange.period === "custom" ? "custom" : dateRange.period,
      limit: String(config.limit || 10),
      site: siteId,
    });
    if (dateRange.date) params.set("date", dateRange.date);
    const filterStr = filtersToString(config.filters);
    if (filterStr) params.set("filters", filterStr);

    fetch(`/api/plausible?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((json) => {
        setData(json.results || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [config, dateRange, siteId]);

  const dimKey = config.dimension.split(":").pop() || config.dimension;
  const maxValue =
    data.length > 0
      ? Math.max(...data.map((r) => Number(r[config.metric]) || 0))
      : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{config.title}</h3>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400">No data</p>
      ) : (
        <div className="space-y-2">
          {data.map((row, i) => {
            const label = String(
              row[dimKey] || row.name || row.goal || `#${i + 1}`
            );
            const value = Number(row[config.metric]) || 0;
            const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
            return (
              <div key={i} className="group relative">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-blue-50 transition-all"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center justify-between px-3 py-1.5">
                  <span
                    className="max-w-[70%] truncate text-sm text-gray-700"
                    title={label}
                  >
                    {label}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {value.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
