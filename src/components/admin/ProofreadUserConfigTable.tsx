"use client";

import { useState } from "react";
import type { ProofreadModel, ProofreadUserConfig } from "@/lib/proofread/types";

type Row = ProofreadUserConfig & { modelLabel: string | null };

interface Props {
  initial: Row[];
  models: ProofreadModel[];
}

export default function ProofreadUserConfigTable({ initial, models }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [email, setEmail] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [promptOverride, setPromptOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelCls = "mb-1 block text-xs font-medium uppercase text-gray-500";

  async function refresh() {
    const res = await fetch("/api/admin/proofread/users");
    const data = await res.json();
    setRows(data.configs || []);
  }

  async function save(payload: {
    email: string;
    modelKey: string | null;
    promptOverride: string | null;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proofread/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function remove(emailVal: string) {
    if (!confirm(`Remove override for ${emailVal}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/proofread/users/${encodeURIComponent(emailVal)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      setRows((prev) => prev.filter((r) => r.email !== emailVal));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email) return;
          if (
            await save({
              email,
              modelKey: modelKey || null,
              promptOverride: promptOverride || null,
            })
          ) {
            setEmail("");
            setModelKey("");
            setPromptOverride("");
          }
        }}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Add / update user
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              required
            />
          </div>
          <div>
            <label className={labelCls}>Model (optional)</label>
            <select
              className={inputCls}
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            >
              <option value="">— system default —</option>
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                  {m.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Prompt override (optional)</label>
          <textarea
            className={inputCls}
            rows={3}
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
            placeholder="Leave empty to use the mode's system prompt."
          />
        </div>
        <button
          type="submit"
          disabled={saving || !email}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Model</th>
              <th className="px-5 py-3">Prompt override</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-10 text-center text-sm text-gray-400"
                >
                  No per-user overrides. Everyone uses the system default.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.email}
                  className="border-b border-gray-50 last:border-0 align-top"
                >
                  <td className="px-5 py-3 font-mono text-xs text-gray-800">
                    {row.email}
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {row.modelLabel || (
                      <span className="text-gray-400">system default</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {row.promptOverride ? (
                      <span className="line-clamp-2">{row.promptOverride}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => remove(row.email)}
                      disabled={saving}
                      className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
