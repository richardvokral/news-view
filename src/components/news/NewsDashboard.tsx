"use client";

import { useState, useEffect, useCallback } from "react";
import TopicTable from "@/components/dashboard/TopicTable";
import FilterBar from "@/components/dashboard/FilterBar";
import StatsBar from "@/components/dashboard/StatsBar";
import type { Topic } from "@/lib/fetchers/types";

interface TopicsResponse {
  topics: Topic[];
  totalArticles: number;
  lastFetch: string | null;
  clusteringMode: string;
}

type LoadingPhase = "idle" | "fetching" | "analyzing" | null;

export default function NewsDashboard() {
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
    const interval = setInterval(fetchTopics, 300000);
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Topics Overview</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setFetching(true);
              setLoadingPhase("fetching");
              try {
                await fetch("/api/cron/fetch-news");
                fetchTopics();
              } catch {
                /* ignore */
              } finally {
                setFetching(false);
              }
            }}
            disabled={fetching}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {fetching ? "Fetching articles..." : "Fetch Now"}
          </button>
          <button
            onClick={fetchTopics}
            disabled={loading || fetching}
            className="rounded bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {(loading || fetching) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <svg
            className="h-4 w-4 animate-spin text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {loadingPhase === "fetching" &&
            "Fetching articles from news sources..."}
          {loadingPhase === "analyzing" && (
            <>
              {data ? `Analyzing ${data.totalArticles} articles` : "Loading articles"}{" "}
              — waiting for{" "}
              {data?.clusteringMode === "ai"
                ? "Claude AI"
                : data?.clusteringMode === "ai-openai"
                  ? "OpenAI"
                  : data?.clusteringMode === "hybrid"
                    ? "hybrid (Claude)"
                    : data?.clusteringMode === "hybrid-openai"
                      ? "hybrid (OpenAI)"
                      : "keyword"}{" "}
              clustering...
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

      <div className="mb-3 flex gap-2">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-500" />
          US
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" />
          DE
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <TopicTable topics={data?.topics ?? []} />
    </div>
  );
}
