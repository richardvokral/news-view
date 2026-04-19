"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { TimeseriesWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const LABEL_COLORS: Record<string, string> = {
  Likes: "#22c55e",
  Dislikes: "#ef4444",
};

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface Props {
  config: TimeseriesWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

export default function TimeseriesChart({
  config,
  dateRange,
  siteId,
}: Props) {
  const [data, setData] = useState<Record<string, string | number>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    let basePeriod =
      dateRange.period === "custom" ? "custom" : dateRange.period;
    let baseDate = dateRange.date;
    if (basePeriod === "custom" && baseDate) {
      const [start, end] = baseDate.split(",");
      if (start && end && start === end) {
        basePeriod = "day";
        baseDate = start;
      }
    }

    if (config.series && config.series.length > 0) {
      Promise.all(
        config.series.map(async (s) => {
          const params = new URLSearchParams({
            endpoint: "timeseries",
            metrics: s.metric,
            period: basePeriod,
            site: siteId,
          });
          if (baseDate) params.set("date", baseDate);
          const filterStr = filtersToString(s.filters);
          if (filterStr) params.set("filters", filterStr);
          const res = await fetch(`/api/plausible?${params}`);
          if (!res.ok) throw new Error("API error");
          const json = await res.json();
          return {
            label: s.label,
            metric: s.metric,
            rows: (json.results || []) as {
              date: string;
              [k: string]: number | string;
            }[],
          };
        })
      )
        .then((results) => {
          const byDate: Record<
            string,
            Record<string, string | number>
          > = {};
          for (const { label, metric, rows } of results) {
            for (const row of rows) {
              if (!byDate[row.date]) byDate[row.date] = { date: row.date };
              byDate[row.date][label] = (row[metric] as number) ?? 0;
            }
          }
          const merged = Object.values(byDate).sort((a, b) =>
            String(a.date).localeCompare(String(b.date))
          );
          setData(merged);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    } else {
      const params = new URLSearchParams({
        endpoint: "timeseries",
        metrics: config.metrics.join(","),
        period: basePeriod,
        site: siteId,
      });
      if (baseDate) params.set("date", baseDate);
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
    }
  }, [config, dateRange, siteId]);

  const seriesKeys = config.series
    ? config.series.map((s) => s.label)
    : config.metrics;

  const isSingleDayCustom =
    dateRange.period === "custom" &&
    dateRange.date?.split(",")[0] === dateRange.date?.split(",")[1];
  const isHourly = dateRange.period === "day" || isSingleDayCustom;

  function formatDate(dateStr: string) {
    if (isHourly) {
      const timePart = dateStr.split(" ")[1];
      if (timePart) return timePart.slice(0, 5);
      const d = new Date(dateStr);
      return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{config.title}</h3>
      {loading ? (
        <div className="h-64 animate-pulse rounded bg-gray-100" />
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip
              labelFormatter={formatDate}
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                fontSize: "13px",
              }}
            />
            {seriesKeys.map((key, i) => {
              const color =
                config.series?.[i]?.color ||
                LABEL_COLORS[key] ||
                COLORS[i % COLORS.length];
              return (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
