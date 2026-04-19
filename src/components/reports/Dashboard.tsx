"use client";

import { useState, useEffect, useCallback } from "react";
import { defaultDashboardConfig } from "@/lib/dashboard/default-config";
import DateRangePicker, {
  type DateRangeValue,
} from "@/components/reports/DateRangePicker";
import DashboardGrid from "@/components/reports/DashboardGrid";
import SaveDropdown from "@/components/reports/SaveDropdown";
import SiteSelector from "@/components/reports/SiteSelector";
import type { WidgetConfig } from "@/types/dashboard";

function RealtimeVisitors({ siteId }: { siteId: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    function fetchRealtime() {
      const params = new URLSearchParams({
        endpoint: "realtime",
        site: siteId,
      });
      fetch(`/api/plausible?${params}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (typeof data === "number") setCount(data);
        })
        .catch(() => {});
    }
    fetchRealtime();
    const interval = setInterval(fetchRealtime, 30000);
    return () => clearInterval(interval);
  }, [siteId]);

  if (count === null) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
      </span>
      <span>
        <strong className="font-semibold text-gray-900">{count}</strong>{" "}
        current {count === 1 ? "visitor" : "visitors"}
      </span>
    </div>
  );
}

interface Props {
  isAdmin: boolean;
  sites: string[];
  currentSite: string;
}

export default function Dashboard({ isAdmin, sites, currentSite }: Props) {
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    period: "30d",
  });
  const [widgets, setWidgets] = useState<WidgetConfig[]>(defaultDashboardConfig);
  const [savedWidgets, setSavedWidgets] =
    useState<WidgetConfig[]>(defaultDashboardConfig);
  const [layoutSource, setLayoutSource] = useState("static");
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasChanges =
    JSON.stringify(widgets) !== JSON.stringify(savedWidgets);

  const fetchLayout = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard-layout");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (Array.isArray(data.widgets)) {
        setWidgets(data.widgets);
        setSavedWidgets(data.widgets);
        setLayoutSource(data.source || "static");
      }
    } catch {
      // Static fallback already set
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLayout();
  }, [fetchLayout]);

  function handleReorder(next: WidgetConfig[]) {
    setWidgets(next);
  }
  function handleDelete(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }
  function handleToggleCols(id: string) {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, cols: w.cols === 2 ? 1 : 2 } : w))
    );
  }
  function handleCancelEdit() {
    setWidgets(savedWidgets);
    setIsEditing(false);
  }
  function handleSaved(newSource: string) {
    if (newSource === "admin_default" && layoutSource === "user") {
      fetchLayout();
      setIsEditing(false);
      return;
    }
    setSavedWidgets(widgets);
    setLayoutSource(newSource);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <SiteSelector sites={sites} current={currentSite} />
          <RealtimeVisitors siteId={currentSite} />
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <SaveDropdown
                widgets={widgets}
                isAdmin={isAdmin}
                layoutSource={layoutSource}
                onSaved={handleSaved}
              />
              {hasChanges && (
                <span className="text-xs font-medium text-amber-600">
                  Unsaved changes
                </span>
              )}
              <button
                onClick={handleCancelEdit}
                className="rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <DateRangePicker value={dateRange} onChange={setDateRange} />
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      ) : (
        <DashboardGrid
          widgets={widgets}
          dateRange={dateRange}
          siteId={currentSite}
          isEditing={isEditing}
          onReorder={handleReorder}
          onDelete={handleDelete}
          onToggleCols={handleToggleCols}
        />
      )}
    </div>
  );
}
