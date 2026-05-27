"use client";

import { useState } from "react";
import type { ProofreadPrompt } from "@/lib/proofread/types";

interface Props {
  initial: ProofreadPrompt[];
}

export default function ProofreadPromptsForm({ initial }: Props) {
  const [prompts, setPrompts] = useState<ProofreadPrompt[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(mode: string, next: Partial<ProofreadPrompt>) {
    setPrompts((prev) =>
      prev.map((p) => (p.mode === mode ? { ...p, ...next } : p))
    );
  }

  async function save(prompt: ProofreadPrompt) {
    setSaving(prompt.mode);
    setError(null);
    try {
      const res = await fetch("/api/admin/proofread/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      const listRes = await fetch("/api/admin/proofread/prompts");
      const data = await listRes.json();
      setPrompts(data.prompts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  if (prompts.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No prompts. Run the DB migration to seed the default modes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {prompts.map((p) => (
        <div
          key={p.mode}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <input
                value={p.label}
                onChange={(e) => patch(p.mode, { label: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="ml-2 font-mono text-xs text-gray-400">
                {p.mode}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={p.isDefaultMode}
                onChange={(e) =>
                  patch(p.mode, { isDefaultMode: e.target.checked })
                }
              />
              Default mode
            </label>
          </div>
          <textarea
            value={p.body}
            onChange={(e) => patch(p.mode, { body: e.target.value })}
            rows={5}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => save(p)}
            disabled={saving === p.mode}
            className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving === p.mode ? "Saving…" : "Save"}
          </button>
        </div>
      ))}
    </div>
  );
}
