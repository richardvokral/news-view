"use client";

import { useCallback, useEffect, useState } from "react";
import AnalysisResult from "./AnalysisResult";
import type { InsightRunResult } from "@/lib/insights/types";

interface RunSummary {
  id: number;
  createdAt: string;
  createdBy: string | null;
  modelKey: string | null;
  promptKey: string | null;
  status: "ok" | "error";
  costCzk: number;
  error: string | null;
  params: { weekStartFrom?: string; weekStartTo?: string } | null;
}

function weekOffset(weeks: number): string {
  const d = new Date();
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift - weeks * 7);
  return d.toISOString().slice(0, 10);
}

export default function ThemesTab({
  site,
  prompts,
  models,
  defaultModelKey,
  defaultTopN,
}: {
  site: string;
  prompts: { key: string; label: string }[];
  models: { key: string; label: string }[];
  defaultModelKey: string | null;
  defaultTopN: number;
}) {
  const [weeks, setWeeks] = useState(13);
  const [topN, setTopN] = useState(defaultTopN);
  const [promptKey, setPromptKey] = useState(prompts[0]?.key ?? "");
  const [modelKey, setModelKey] = useState(defaultModelKey ?? models[0]?.key ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InsightRunResult | null>(null);
  const [meta, setMeta] = useState<{ costCzk: number; label: string } | null>(
    null
  );
  const [history, setHistory] = useState<RunSummary[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/insights/analyses?site=${encodeURIComponent(site)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.runs ?? []);
    } catch {
      // History is a convenience.
    }
  }, [site]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          from: weekOffset(weeks),
          to: weekOffset(1),
          topN,
          promptKey: promptKey || undefined,
          modelKey: modelKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data.result);
      setMeta({
        costCzk: data.costCzk ?? 0,
        label: data.model?.label ?? "",
      });
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [site, weeks, topN, promptKey, modelKey, loadHistory]);

  const openRun = useCallback(async (id: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/insights/analyses?id=${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.run?.result) throw new Error("Tento běh nemá uložený výsledek.");
      setResult(data.run.result);
      setMeta({ costCzk: data.run.costCzk ?? 0, label: data.run.modelId ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div>
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Období
            </span>
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {[4, 8, 13, 26, 52].map((w) => (
                <option key={w} value={w}>
                  Posledních {w} týdnů
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Článků
            </span>
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {[100, 200, 300, 600].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Prompt
            </span>
            <select
              value={promptKey}
              onChange={(e) => setPromptKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {prompts.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Model
            </span>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={run}
            disabled={running || models.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? "Analyzuji…" : "Spustit analýzu"}
          </button>

          {meta && !running && (
            <span className="text-xs text-gray-500">
              {meta.label} · {meta.costCzk.toFixed(2)} Kč
            </span>
          )}
        </div>
        {models.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            Není zapnutý žádný AI model — nastavte ho v Adminu.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result ? (
        <AnalysisResult result={result} />
      ) : (
        !running && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            Spusťte analýzu, nebo otevřete dřívější běh níže.
          </div>
        )
      )}

      {history.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Dřívější analýzy
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {new Date(h.createdAt).toLocaleString("cs-CZ")}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {h.params?.weekStartFrom} – {h.params?.weekStartTo}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {h.promptKey ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {h.modelKey ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                      {h.costCzk.toFixed(2)} Kč
                    </td>
                    <td className="px-3 py-2 text-right">
                      {h.status === "ok" ? (
                        <button
                          type="button"
                          onClick={() => openRun(h.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Zobrazit
                        </button>
                      ) : (
                        <span
                          className="text-xs text-red-600"
                          title={h.error ?? ""}
                        >
                          chyba
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
