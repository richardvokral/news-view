"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ComputedTimeseriesWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

function mergeFilters(
  base?: [string, string, string[]][],
  extra?: [string, string, string[]][]
): [string, string, string[]][] {
  return [...(base || []), ...(extra || [])];
}

interface Props {
  config: ComputedTimeseriesWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

interface ChartRow {
  date: string;
  total: number;
  events: number;
}

export default function ComputedTimeseriesChart({
  config,
  dateRange,
  siteId,
}: Props) {
  const [data, setData] = useState<ChartRow[]>([]);
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
    const baseFilterStr = filtersToString(config.filters);

    const breakdownParams = new URLSearchParams({
      endpoint: "breakdown",
      property: config.dimension,
      metrics: config.metric,
      period: basePeriod,
      limit: "100",
      site: siteId,
    });
    if (baseDate) breakdownParams.set("date", baseDate);
    if (baseFilterStr) breakdownParams.set("filters", baseFilterStr);

    fetch(`/api/plausible?${breakdownParams}`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((breakdownData) => {
        const rows: Record<string, string | number>[] =
          breakdownData.results || [];
        const dimKey = config.dimension.split(":").pop() || config.dimension;
        const uniqueValues = rows
          .map((r) => String(r[dimKey]))
          .filter((v) => !isNaN(Number(v)));

        if (uniqueValues.length === 0) {
          setData([]);
          setLoading(false);
          return;
        }

        return Promise.all(
          uniqueValues.map(async (val) => {
            const valueFilter: [string, string, string[]][] = [
              ["is", config.dimension, [val]],
            ];
            const combined = mergeFilters(config.filters, valueFilter);
            const params = new URLSearchParams({
              endpoint: "timeseries",
              metrics: config.metric,
              period: basePeriod,
              site: siteId,
            });
            if (baseDate) params.set("date", baseDate);
            const f = filtersToString(combined);
            if (f) params.set("filters", f);

            const res = await fetch(`/api/plausible?${params}`);
            if (!res.ok) throw new Error("API error");
            const json = await res.json();
            return {
              value: Number(val),
              rows: (json.results || []) as {
                date: string;
                [k: string]: number | string;
              }[],
            };
          })
        ).then((seriesResults) => {
          const byDate: Record<string, { total: number; events: number }> = {};
          for (const { value, rows: tsRows } of seriesResults) {
            for (const row of tsRows) {
              const d = row.date as string;
              if (!byDate[d]) byDate[d] = { total: 0, events: 0 };
              const count = (row[config.metric] as number) ?? 0;
              byDate[d].total += value * count;
              byDate[d].events += count;
            }
          }
          const merged: ChartRow[] = Object.entries(byDate)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, vals]) => ({
              date,
              total: vals.total,
              events: vals.events,
            }));
          setData(merged);
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [config, dateRange, siteId]);

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

  const maxEvents = data.reduce((max, row) => Math.max(max, row.events), 0);
  const rightAxisMax = Math.max(10, Math.ceil(maxEvents / 10) * 10);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{config.title}</h3>
      {loading ? (
        <div className="h-64 animate-pulse rounded bg-gray-100" />
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, rightAxisMax]}
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
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar
              yAxisId="right"
              dataKey="events"
              name="Events"
              fill="#93c5fd"
              opacity={0.6}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="total"
              name="Total"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
