"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews?: number | null;
}

interface Props {
  snapshots: Snapshot[];
  size?: "sm" | "lg";
}

export default function ArticleSparkline({ snapshots, size = "sm" }: Props) {
  const isLarge = size === "lg";

  if (snapshots.length < 2) {
    return (
      <div
        className={
          isLarge
            ? "flex h-48 w-full items-center justify-center rounded bg-gray-50 text-xs text-gray-400"
            : "h-10 w-32 rounded bg-gray-50"
        }
      >
        {isLarge ? "Not enough data yet" : null}
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    t: new Date(s.capturedAt).getTime(),
    v: s.visitors ?? 0,
  }));

  if (!isLarge) {
    return (
      <div className="h-10 w-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Area
              type="monotone"
              dataKey="v"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.15}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-48 w-full">
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
            formatter={(v: number) => [v.toLocaleString(), "Visitors"]}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.15}
            strokeWidth={1.75}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
