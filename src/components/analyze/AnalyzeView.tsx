"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DateRangePicker, {
  type DateRangeValue,
} from "@/components/reports/DateRangePicker";
import Transcript, { type Turn } from "./Transcript";
import { type StepEvent } from "./StepLog";

interface Props {
  sites: string[];
  currentSite: string;
}

function newTurnId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AnalyzeView({ sites, currentSite }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ period: "30d" });
  const abortRef = useRef<AbortController | null>(null);

  const running = turns.some((t) => t.status === "running");

  function handleSiteChange(value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("site", value);
    router.push(`/analyze?${params.toString()}`);
  }

  function patchTurn(id: string, patch: (t: Turn) => Turn) {
    setTurns((prev) => prev.map((t) => (t.id === id ? patch(t) : t)));
  }

  function appendEvent(id: string, event: StepEvent) {
    patchTurn(id, (t) => ({ ...t, events: [...t.events, event] }));
  }

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || running) return;

    const id = newTurnId();
    const newTurn: Turn = {
      id,
      question: trimmed,
      events: [],
      answer: null,
      error: null,
      status: "running",
    };
    setTurns((prev) => [...prev, newTurn]);
    setQuestion("");

    const history = turns
      .filter((t) => t.answer && t.status === "done")
      .flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer ?? "" },
      ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          period: dateRange.period,
          date: dateRange.date,
          site: currentSite,
          history,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Request failed");
        patchTurn(id, (t) => ({
          ...t,
          status: "error",
          error: `Request failed (${res.status}): ${errText.slice(0, 300)}`,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          let event: StepEvent;
          try {
            event = JSON.parse(payload) as StepEvent;
          } catch {
            continue;
          }
          appendEvent(id, event);
          if (event.step === "answer" && typeof event.text === "string") {
            const text = event.text;
            patchTurn(id, (t) => ({ ...t, answer: text }));
          } else if (event.step === "error") {
            const message =
              typeof event.message === "string" ? event.message : "Unknown error";
            patchTurn(id, (t) => ({
              ...t,
              status: "error",
              error: t.error ?? message,
            }));
          } else if (event.step === "done") {
            patchTurn(id, (t) =>
              t.status === "running"
                ? { ...t, status: t.answer ? "done" : "error", error: t.answer ? null : (t.error ?? "No answer returned") }
                : t
            );
          }
        }
      }

      patchTurn(id, (t) =>
        t.status === "running"
          ? { ...t, status: t.answer ? "done" : "error", error: t.answer ? null : (t.error ?? "Stream ended without an answer") }
          : t
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network error";
      patchTurn(id, (t) => ({
        ...t,
        status: "error",
        error: t.error ?? message,
      }));
    } finally {
      abortRef.current = null;
    }
  }

  function clearConversation() {
    if (running) return;
    setTurns([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Analyze</h1>
          <p className="text-sm text-gray-500">
            Ask plain-text questions about your Plausible analytics. Powered by
            Claude with live tool use.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sites.length > 1 && (
            <select
              value={currentSite}
              onChange={(e) => handleSiteChange(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <button
            type="button"
            onClick={clearConversation}
            disabled={running || turns.length === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title="Clear the in-memory conversation (session only)"
          >
            Clear
          </button>
        </div>
      </div>

      <Transcript turns={turns} />

      <div className="sticky bottom-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            turns.length === 0
              ? "e.g. How is traffic from seznam compared to whole traffic, and when did it start to decline?"
              : "Ask a follow-up… (Enter to send, Shift+Enter for newline)"
          }
          rows={3}
          className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Site: <span className="font-medium text-gray-700">{currentSite}</span>
            {" · "}Range:{" "}
            <span className="font-medium text-gray-700">
              {dateRange.period === "custom" && dateRange.date
                ? dateRange.date
                : dateRange.period}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void ask()}
            disabled={running || !question.trim()}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? "Asking…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
