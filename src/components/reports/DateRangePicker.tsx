"use client";

import { useState, useRef, useEffect } from "react";

export interface DateRangeValue {
  period: string;
  date?: string;
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const PRESETS: { label: string; period: string; date?: string }[] = [
  { label: "Today", period: "day" },
  { label: "Yesterday", period: "day", date: getYesterday() },
  { label: "Last 7 days", period: "7d" },
  { label: "Last 30 days", period: "30d" },
  { label: "Last 6 months", period: "6mo" },
  { label: "Last 12 months", period: "12mo" },
];

interface Props {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

export default function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
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

  const currentLabel =
    value.period === "custom" && value.date
      ? value.date
      : PRESETS.find(
          (p) => p.period === value.period && p.date === value.date
        )?.label ||
        PRESETS.find((p) => p.period === value.period && !p.date)?.label ||
        value.period;

  function handleCustomApply() {
    if (customStart && customEnd) {
      onChange({ period: "custom", date: `${customStart},${customEnd}` });
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <svg
          className="h-4 w-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        {currentLabel}
        <svg
          className="h-4 w-4 text-gray-400"
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
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-2">
            {PRESETS.map((preset) => {
              const isActive =
                value.period === preset.period &&
                (value.date || undefined) === preset.date;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    onChange({ period: preset.period, date: preset.date });
                    setOpen(false);
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="border-t border-gray-200 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-gray-500">
              Custom Range
            </p>
            <div className="space-y-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleCustomApply}
                disabled={!customStart || !customEnd}
                className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
