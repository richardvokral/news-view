"use client";

import { useState } from "react";
import CountryComparison from "./CountryComparison";
import { Topic } from "@/lib/fetchers/types";

interface TopicTableProps {
  topics: Topic[];
}

type SortKey = "urgency" | "trend" | "total" | "us" | "de" | "latest";
type SortDir = "asc" | "desc";

export default function TopicTable({ topics }: TopicTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const multiplier = sortDir === "desc" ? 1 : -1;

  const sorted = [...topics].sort((a, b) => {
    switch (sortKey) {
      case "urgency":
        return (b.urgency - a.urgency) * multiplier;
      case "trend":
        return ((b.trendScore - a.trendScore) || (b.totalArticles - a.totalArticles)) * multiplier;
      case "total":
        return (b.totalArticles - a.totalArticles) * multiplier;
      case "us":
        return (b.countByCountry.us - a.countByCountry.us) * multiplier;
      case "de":
        return (b.countByCountry.de - a.countByCountry.de) * multiplier;
      case "latest":
        return b.latestPublishedAt.localeCompare(a.latestPublishedAt) * multiplier;
      default:
        return 0;
    }
  });

  if (topics.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-400">
        No topics found. Trigger a fetch or wait for the next cron run.
      </div>
    );
  }

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " \u2193" : " \u2191";
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">
              Topic
            </th>
            <th className="text-center text-xs font-medium text-gray-500 px-4 py-3 w-20">
              <button
                onClick={() => handleSort("urgency")}
                className={`${sortKey === "urgency" ? "text-blue-600 font-bold" : ""}`}
              >
                Urgency{arrow("urgency")}
              </button>
            </th>
            <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 w-16">
              <button
                onClick={() => handleSort("trend")}
                className={sortKey === "trend" ? "text-blue-600 font-bold" : ""}
              >
                Trend{arrow("trend")}
              </button>
            </th>
            <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 w-40">
              <div className="flex gap-2">
                <button
                  onClick={() => handleSort("us")}
                  className={sortKey === "us" ? "text-blue-600 font-bold" : ""}
                >
                  US{arrow("us")}
                </button>
                <span>/</span>
                <button
                  onClick={() => handleSort("de")}
                  className={sortKey === "de" ? "text-blue-600 font-bold" : ""}
                >
                  DE{arrow("de")}
                </button>
              </div>
            </th>
            <th className="text-center text-xs font-medium text-gray-500 px-4 py-3 w-16">
              <button
                onClick={() => handleSort("total")}
                className={sortKey === "total" ? "text-blue-600 font-bold" : ""}
              >
                Total{arrow("total")}
              </button>
            </th>
            <th className="text-right text-xs font-medium text-gray-500 px-4 py-3 w-28">
              <button
                onClick={() => handleSort("latest")}
                className={sortKey === "latest" ? "text-blue-600 font-bold" : ""}
              >
                Last Update{arrow("latest")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              expanded={expandedId === topic.id}
              onToggle={() =>
                setExpandedId(expandedId === topic.id ? null : topic.id)
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopicRow({
  topic,
  expanded,
  onToggle,
}: {
  topic: Topic;
  expanded: boolean;
  onToggle: () => void;
}) {
  const trendLabel = getTrendLabel(topic.trendScore);
  const timeAgo = formatTimeAgo(new Date(topic.latestPublishedAt));

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{expanded ? "v" : ">"}</span>
            <div>
              <div className="font-medium text-sm text-gray-900">
                {topic.name}
              </div>
              {topic.category && (
                <span className="text-xs text-gray-400">{topic.category}</span>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <UrgencyBadge urgency={topic.urgency} />
        </td>
        <td className="px-4 py-3">
          <span className={`text-sm ${trendLabel.color}`}>
            {trendLabel.icon}
          </span>
        </td>
        <td className="px-4 py-3">
          <CountryComparison
            us={topic.countByCountry.us}
            de={topic.countByCountry.de}
          />
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-mono text-gray-700">
            {topic.totalArticles}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs text-gray-400">{timeAgo}</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-gray-50 px-4 py-3">
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {topic.articles.map((article) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-2 rounded hover:bg-white transition-colors group"
                >
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      article.sourceCountry === "us"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {article.sourceCountry.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700 group-hover:text-blue-600 truncate">
                      {article.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {article.source} &middot;{" "}
                      {new Date(article.publishedAt).toLocaleString()}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function UrgencyBadge({ urgency }: { urgency: number }) {
  const config: Record<number, { bg: string; text: string; label: string }> = {
    1: { bg: "bg-gray-100", text: "text-gray-500", label: "1" },
    2: { bg: "bg-blue-100", text: "text-blue-600", label: "2" },
    3: { bg: "bg-yellow-100", text: "text-yellow-700", label: "3" },
    4: { bg: "bg-orange-100", text: "text-orange-700", label: "4" },
    5: { bg: "bg-red-100", text: "text-red-700", label: "5" },
  };
  const c = config[urgency] || config[1];
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function getTrendLabel(score: number): { icon: string; color: string } {
  if (score >= 0.5) return { icon: "^^ Hot", color: "text-red-500 font-bold" };
  if (score >= 0.2) return { icon: "^ Up", color: "text-orange-500" };
  if (score > 0) return { icon: "~ ", color: "text-gray-400" };
  return { icon: "- ", color: "text-gray-300" };
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
