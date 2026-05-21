"use client";

import { useState } from "react";

export interface StepEvent {
  step: string;
  ts?: number;
  [key: string]: unknown;
}

interface Props {
  events: StepEvent[];
  defaultOpen?: boolean;
}

function stepMeta(step: string): { label: string; tone: string } {
  switch (step) {
    case "start":
      return { label: "Start", tone: "text-gray-600" };
    case "ai_request":
      return { label: "AI request sent", tone: "text-blue-700" };
    case "ai_response":
      return { label: "AI response received", tone: "text-blue-700" };
    case "tool_request":
      return { label: "Plausible query sent", tone: "text-amber-700" };
    case "tool_response":
      return { label: "Plausible data received", tone: "text-emerald-700" };
    case "tool_error":
      return { label: "Plausible error", tone: "text-red-700" };
    case "answer":
      return { label: "Final answer", tone: "text-emerald-800" };
    case "error":
      return { label: "Error", tone: "text-red-700" };
    case "done":
      return { label: "Done", tone: "text-gray-600" };
    default:
      return { label: step, tone: "text-gray-700" };
  }
}

function formatTs(events: StepEvent[], idx: number): string {
  const ev = events[idx];
  const start = events[0];
  if (!ev?.ts || !start?.ts) return "";
  const elapsed = (Number(ev.ts) - Number(start.ts)) / 1000;
  return `+${elapsed.toFixed(2)}s`;
}

function detailFor(ev: StepEvent): unknown {
  const { step: _step, ts: _ts, ...rest } = ev;
  void _step;
  void _ts;
  return rest;
}

export default function StepLog({ events, defaultOpen = false }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (events.length === 0) return null;

  return (
    <details className="rounded-md border border-gray-200 bg-gray-50" open={defaultOpen}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100">
        Debug log ({events.length} step{events.length === 1 ? "" : "s"})
      </summary>
      <ol className="divide-y divide-gray-200 border-t border-gray-200">
        {events.map((ev, idx) => {
          const meta = stepMeta(ev.step);
          const detail = detailFor(ev);
          const isOpen = openIdx === idx;
          return (
            <li key={idx} className="px-3 py-2 text-xs">
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className={`font-medium ${meta.tone}`}>
                  {idx + 1}. {meta.label}
                </span>
                <span className="font-mono text-[10px] text-gray-400">
                  {formatTs(events, idx)}
                </span>
              </button>
              {isOpen && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] text-gray-700 ring-1 ring-gray-200">
                  {JSON.stringify(detail, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
