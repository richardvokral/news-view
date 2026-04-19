"use client";

import { useEffect, useState } from "react";
import type { MetricWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function formatMetricValue(metric: string, value: number): string {
  if (metric === "bounce_rate") return `${value}%`;
  if (metric === "visit_duration") {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  return value.toLocaleString();
}

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface Props {
  config: MetricWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

export default function MetricCard({ config, dateRange, siteId }: Props) {
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      endpoint: "aggregate",
      metrics: config.metric,
      period: dateRange.period === "custom" ? "custom" : dateRange.period,
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
        const result = data.results?.[config.metric]?.value ?? 0;
        setValue(result);
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
          {formatMetricValue(config.metric, value ?? 0)}
        </p>
      )}
    </div>
  );
}
