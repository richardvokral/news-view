"use client";

import { useState, useRef, useEffect } from "react";
import type { WidgetConfig } from "@/types/dashboard";

interface Props {
  widgets: WidgetConfig[];
  isAdmin: boolean;
  layoutSource: string;
  onSaved: (source: string) => void;
}

export default function SaveDropdown({
  widgets,
  isAdmin,
  layoutSource,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [message]);

  async function handleSave(saveMode: string) {
    setSaving(true);
    setOpen(false);
    try {
      const body: Record<string, unknown> = { saveMode };
      if (saveMode !== "restore_default") {
        body.widgets = widgets;
      }
      const res = await fetch("/api/dashboard-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      const newSource =
        saveMode === "restore_default"
          ? "admin_default"
          : saveMode === "save_as_default"
            ? "admin_default"
            : "user";
      onSaved(newSource);
      setMessage("Saved!");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-1">
            <button
              onClick={() => handleSave("save_for_me")}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              Save for Me
            </button>
            {isAdmin && (
              <button
                onClick={() => handleSave("save_as_default")}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                Save as Default for Everyone
              </button>
            )}
            {layoutSource === "user" && (
              <button
                onClick={() => handleSave("restore_default")}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                Restore Default
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="absolute right-0 top-full z-50 mt-1 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg">
          {message}
        </div>
      )}
    </div>
  );
}
