"use client";

import { useState } from "react";
import type { InsightPrompt } from "@/lib/insights/promptStore";

export default function InsightsPromptsForm({
  initial,
}: {
  initial: InsightPrompt[];
}) {
  const [prompts, setPrompts] = useState<InsightPrompt[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(key: string, next: Partial<InsightPrompt>) {
    setPrompts((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...next } : p))
    );
  }

  async function save(prompt: InsightPrompt) {
    setSaving(prompt.key);
    setError(null);
    try {
      const res = await fetch("/api/admin/insights/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setPrompts(data.prompts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  if (prompts.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Žádné prompty. Spusťte migraci databáze a načtěte stránku znovu.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {prompts.map((p) => (
        <div
          key={p.key}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <input
                value={p.label}
                onChange={(e) => patch(p.key, { label: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="ml-2 font-mono text-xs text-gray-400">
                {p.key} · v{p.version}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={p.isDefault}
                onChange={(e) => patch(p.key, { isDefault: e.target.checked })}
              />
              výchozí
            </label>
          </div>
          <textarea
            value={p.body}
            onChange={(e) => patch(p.key, { body: e.target.value })}
            rows={8}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => save(p)}
              disabled={saving === p.key}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving === p.key ? "Ukládám…" : "Uložit"}
            </button>
            {p.updatedBy && (
              <span className="text-xs text-gray-500">
                naposledy {p.updatedBy}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
