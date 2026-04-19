"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from "recharts";
import type { PieWidgetConfig } from "@/types/dashboard";
import type { DateRangeValue } from "@/components/reports/DateRangePicker";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function filtersToString(
  filters?: [string, string, string[]][]
): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f[1]}==${f[2][0]}`).join(";");
}

interface Props {
  config: PieWidgetConfig;
  dateRange: DateRangeValue;
  siteId: string;
}

interface PieRow {
  [key: string]: string | number;
}

export default function PieBreakdown({ config, dateRange, siteId }: Props) {
  const [data, setData] = useState<PieRow[]>([]);
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
      limit: String(config.limit || 6),
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
  const chartData = data.map((row) => ({
    name: String(row[dimKey] || row.name || "Unknown"),
    value: Number(row[config.metric]) || 0,
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{config.title}</h3>
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-32 w-32 animate-pulse rounded-full bg-gray-100" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-gray-400">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                fontSize: "13px",
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: "12px" }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
