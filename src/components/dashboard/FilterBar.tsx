"use client";

const CATEGORIES = [
  "world",
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "sports",
  "entertainment",
  "environment",
];

interface FilterBarProps {
  excluded: Set<string>;
  onToggle: (category: string) => void;
  clusteringMode: string;
  lastFetch: string | null;
  totalArticles: number;
}

export default function FilterBar({
  excluded,
  onToggle,
  clusteringMode,
  lastFetch,
  totalArticles,
}: FilterBarProps) {
  const lastFetchLabel = lastFetch
    ? formatTimeAgo(new Date(lastFetch))
    : "never";

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-gray-500 self-center mr-1">
            Exclude:
          </span>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onToggle(cat)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                excluded.has(cat)
                  ? "bg-red-100 text-red-700 line-through"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{totalArticles} articles</span>
          <span>|</span>
          <span>Mode: {clusteringMode}</span>
          <span>|</span>
          <span>Updated {lastFetchLabel}</span>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
