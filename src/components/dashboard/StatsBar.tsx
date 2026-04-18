"use client";

import { useState, useEffect } from "react";

interface HourlyBucket {
  hour: string;
  count: number;
}

interface StatsData {
  total48h: number;
  hourly: HourlyBucket[];
}

export default function StatsBar() {
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const max = Math.max(...stats.hourly.map((h) => h.count), 1);
  const now = Date.now();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700">
          Article Activity (48h)
        </h2>
        <span className="text-sm font-mono text-blue-600">
          {stats.total48h} articles
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: 60 }}>
        {stats.hourly.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
            No data yet
          </div>
        ) : (
          fillHourlyBuckets(stats.hourly).map((bucket, i) => {
            const height = max > 0 ? (bucket.count / max) * 100 : 0;
            const hourAgo =
              (now - new Date(bucket.hour).getTime()) / (1000 * 60 * 60);
            const isRecent = hourAgo < 6;

            return (
              <div
                key={bucket.hour}
                className="flex-1 relative group"
                style={{ height: "100%" }}
              >
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-t-sm transition-colors ${
                    isRecent ? "bg-blue-400" : "bg-gray-300"
                  } ${bucket.count > 0 ? "group-hover:bg-blue-500" : ""}`}
                  style={{
                    height: `${Math.max(height, bucket.count > 0 ? 4 : 0)}%`,
                    minHeight: bucket.count > 0 ? 2 : 0,
                  }}
                />
                {bucket.count > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {formatHour(bucket.hour)}: {bucket.count}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400">48h ago</span>
        <span className="text-[10px] text-gray-400">now</span>
      </div>
    </div>
  );
}

function fillHourlyBuckets(hourly: HourlyBucket[]): HourlyBucket[] {
  const map = new Map(hourly.map((h) => [h.hour, h.count]));
  const buckets: HourlyBucket[] = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);

  for (let i = 47; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = d.toISOString();
    buckets.push({ hour: key, count: map.get(key) || 0 });
  }

  // Match by hour (ignore minute differences in keys)
  if (buckets.every((b) => b.count === 0) && hourly.length > 0) {
    for (const h of hourly) {
      const hDate = new Date(h.hour);
      hDate.setMinutes(0, 0, 0);
      const idx = buckets.findIndex(
        (b) => new Date(b.hour).getTime() === hDate.getTime()
      );
      if (idx >= 0) {
        buckets[idx].count = h.count;
      }
    }
  }

  return buckets;
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
