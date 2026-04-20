"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface TimeseriesPoint {
  capturedAt: string;
  values: Record<string, number>;
}

interface Props {
  points: TimeseriesPoint[];
  topSources: string[];
}

// Stable palette for up to 5 stacked series.
const COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
];

export default function ArticleSourceTimeseriesChart({
  points,
  topSources,
}: Props) {
  if (!points || points.length < 2 || topSources.length === 0) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded bg-gray-50 text-xs text-gray-400">
        Not enough source-over-time data yet.
      </div>
    );
  }

  const data = points.map((p) => {
    const row: Record<string, number | string> = {
      t: new Date(p.capturedAt).getTime(),
    };
    for (const s of topSources) {
      row[s] = p.values[s] ?? 0;
    }
    return row;
  });

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) =>
              new Date(Number(t)).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            tick={{ fontSize: 11, fill: "#6b7280" }}
            stroke="#e5e7eb"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            stroke="#e5e7eb"
            allowDecimals={false}
          />
          <Tooltip
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              })
            }
            formatter={(v: number, name: string) => [
              v.toLocaleString(),
              name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="square"
            iconSize={8}
          />
          {topSources.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="sources"
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.35}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
