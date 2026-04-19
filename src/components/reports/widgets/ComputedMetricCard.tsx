"use client";

import { useEffect, useState } from "react";
import type { ComputedMetricWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface Props {
  config: ComputedMetricWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

export default function ComputedMetricCard({
  config,
  dateRange,
  siteId,
}: Props) {
  const [value, setValue] = useState<number | null>(null);
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
      limit: "100",
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
      .then((data) => {
        const rows: Record<string, string | number>[] = data.results || [];
        const dimKey = config.dimension.split(":").pop() || config.dimension;
        if (config.computation === "weighted_sum") {
          const total = rows.reduce((sum, row) => {
            const weight = Number(row[dimKey]) || 0;
            const count = Number(row[config.metric]) || 0;
            return sum + weight * count;
          }, 0);
          setValue(total);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [config, dateRange, siteId]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{config.title}</p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-gray-200" />
      ) : error ? (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      ) : (
        <p className="mt-1 text-3xl font-semibold text-gray-900">
          {(value ?? 0).toLocaleString()}
        </p>
      )}
    </div>
  );
}
