"use client";

import { useState, useEffect, useCallback } from "react";
import TopicTable from "@/components/dashboard/TopicTable";
import FilterBar from "@/components/dashboard/FilterBar";
import { Topic } from "@/lib/fetchers/types";

interface TopicsResponse {
  topics: Topic[];
  totalArticles: number;
  lastFetch: string | null;
  clusteringMode: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<TopicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const fetchTopics = useCallback(async () => {
    try {
      setLoading(true);
      const excludeParam =
        excluded.size > 0 ? `?exclude=${[...excluded].join(",")}` : "";
      const res = await fetch(`/api/topics${excludeParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [excluded]);

  useEffect(() => {
    fetchTopics();
    const interval = setInterval(fetchTopics, 60000);
    return () => clearInterval(interval);
  }, [fetchTopics]);

  const toggleCategory = (cat: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Topics Overview</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                await fetch("/api/cron/fetch-news");
                fetchTopics();
              } catch { /* ignore */ }
            }}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Fetch Now
          </button>
          <button
            onClick={fetchTopics}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <FilterBar
        excluded={excluded}
        onToggle={toggleCategory}
        clusteringMode={data?.clusteringMode ?? "keywords"}
        lastFetch={data?.lastFetch ?? null}
        totalArticles={data?.totalArticles ?? 0}
      />

      <div className="flex gap-2 mb-3">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="w-3 h-3 bg-blue-500 rounded-sm inline-block" />
          US
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="w-3 h-3 bg-amber-500 rounded-sm inline-block" />
          DE
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <TopicTable topics={data?.topics ?? []} />
    </div>
  );
}
