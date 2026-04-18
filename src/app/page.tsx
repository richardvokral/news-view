"use client";

import { useState, useEffect, useCallback } from "react";
import TopicTable from "@/components/dashboard/TopicTable";
import FilterBar from "@/components/dashboard/FilterBar";
import StatsBar from "@/components/dashboard/StatsBar";
import { Topic } from "@/lib/fetchers/types";

interface TopicsResponse {
  topics: Topic[];
  totalArticles: number;
  lastFetch: string | null;
  clusteringMode: string;
}

type LoadingPhase = "idle" | "fetching" | "analyzing" | null;

export default function DashboardPage() {
  const [data, setData] = useState<TopicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("fetching");
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);

  const fetchTopics = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingPhase("analyzing");
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
      setLoadingPhase(null);
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
              setFetching(true);
              setLoadingPhase("fetching");
              try {
                await fetch("/api/cron/fetch-news");
                fetchTopics();
              } catch { /* ignore */ } finally {
                setFetching(false);
              }
            }}
            disabled={fetching}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {fetching ? "Fetching articles..." : "Fetch Now"}
          </button>
          <button
            onClick={fetchTopics}
            disabled={loading || fetching}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {(loading || fetching) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm text-blue-700 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {loadingPhase === "fetching" && "Fetching articles from news sources..."}
          {loadingPhase === "analyzing" && (
            <>
              {data ? `Analyzing ${data.totalArticles} articles` : "Loading articles"}
              {" "}— waiting for {data?.clusteringMode === "ai" ? "Claude AI" : data?.clusteringMode === "ai-openai" ? "OpenAI" : "keyword"} clustering...
            </>
          )}
          {!loadingPhase && "Loading..."}
        </div>
      )}

      <StatsBar />

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
