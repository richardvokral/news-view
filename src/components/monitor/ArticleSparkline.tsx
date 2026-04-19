"use client";

import { ResponsiveContainer, AreaChart, Area } from "recharts";

interface Snapshot {
  capturedAt: string;
  visitors: number | null;
  pageviews?: number | null;
}

interface Props {
  snapshots: Snapshot[];
}

export default function ArticleSparkline({ snapshots }: Props) {
  if (snapshots.length < 2) {
    return <div className="h-10 w-32 rounded bg-gray-50" />;
  }
  const data = snapshots.map((s) => ({
    t: s.capturedAt,
    v: s.visitors ?? 0,
  }));
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
