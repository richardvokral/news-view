"use client";

import { useState } from "react";
import type { ProofreadModel, Provider } from "@/lib/proofread/types";

interface Props {
  initial: ProofreadModel[];
  initialDefaultKey: string | null;
}

const EMPTY: ProofreadModel = {
  key: "",
  provider: "openai",
  modelId: "",
  label: "",
  enabled: true,
  inputUsdPerMtok: 0,
  outputUsdPerMtok: 0,
  sortOrder: 0,
};

export default function ProofreadModelsTable({
  initial,
  initialDefaultKey,
}: Props) {
  const [rows, setRows] = useState<ProofreadModel[]>(initial);
  const [defaultKey, setDefaultKey] = useState<string | null>(
    initialDefaultKey
  );
  const [draft, setDraft] = useState<ProofreadModel>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [mRes, dRes] = await Promise.all([
      fetch("/api/admin/proofread/models"),
      fetch("/api/admin/proofread/default-model"),
    ]);
    const mData = await mRes.json();
    const dData = await dRes.json();
    setRows(mData.models || []);
    setDefaultKey(dData.defaultModelKey ?? null);
  }

  async function save(model: ProofreadModel) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proofread/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
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

  async function remove(key: string) {
    if (!confirm(`Delete model ${key}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/proofread/models/${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(key: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proofread/default-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error("Save failed");
      setDefaultKey(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.key || !draft.modelId) return;
          if (await save(draft)) setDraft(EMPTY);
        }}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Add model</h2>
        <ModelFields value={draft} onChange={setDraft} />
        <button
          type="submit"
          disabled={saving || !draft.key || !draft.modelId}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add model"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-3">Model</th>
              <th className="px-5 py-3">Prices ($/1M)</th>
              <th className="px-5 py-3">Enabled</th>
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
                  No models. Run the DB migration to seed defaults.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <ModelRow
                  key={row.key}
                  row={row}
                  isDefault={row.key === defaultKey}
                  disabled={saving}
                  onSave={save}
                  onDelete={() => remove(row.key)}
                  onMakeDefault={() => makeDefault(row.key)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelFields({
  value,
  onChange,
  lockKey,
}: {
  value: ProofreadModel;
  onChange: (m: ProofreadModel) => void;
  lockKey?: boolean;
}) {
  const inputCls =
    "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelCls = "mb-1 block text-xs font-medium uppercase text-gray-500";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <label className={labelCls}>Key</label>
        <input
          className={inputCls}
          value={value.key}
          disabled={lockKey}
          placeholder="openai:gpt-4o-mini"
          onChange={(e) => onChange({ ...value, key: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>Provider</label>
        <select
          className={inputCls}
          value={value.provider}
          onChange={(e) =>
            onChange({ ...value, provider: e.target.value as Provider })
          }
        >
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Model id</label>
        <input
          className={inputCls}
          value={value.modelId}
          placeholder="gpt-4o-mini"
          onChange={(e) => onChange({ ...value, modelId: e.target.value })}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className={labelCls}>Label</label>
        <input
          className={inputCls}
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>Input $/1M</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className={inputCls}
          value={value.inputUsdPerMtok}
          onChange={(e) =>
            onChange({ ...value, inputUsdPerMtok: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label className={labelCls}>Output $/1M</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className={inputCls}
          value={value.outputUsdPerMtok}
          onChange={(e) =>
            onChange({ ...value, outputUsdPerMtok: Number(e.target.value) })
          }
        />
      </div>
    </div>
  );
}

function ModelRow({
  row,
  isDefault,
  disabled,
  onSave,
  onDelete,
  onMakeDefault,
}: {
  row: ProofreadModel;
  isDefault: boolean;
  disabled: boolean;
  onSave: (m: ProofreadModel) => Promise<boolean>;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  const [edit, setEdit] = useState<ProofreadModel>(row);
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-gray-50 last:border-0 align-top">
        <td className="px-5 py-3">
          <div className="font-medium text-gray-900">
            {row.label}
            {isDefault && (
              <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                default
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-gray-500">{row.key}</div>
          <div className="text-xs text-gray-400">
            {row.provider} · {row.modelId}
          </div>
        </td>
        <td className="px-5 py-3 text-gray-700">
          {row.inputUsdPerMtok} / {row.outputUsdPerMtok}
        </td>
        <td className="px-5 py-3">
          <button
            disabled={disabled}
            onClick={() => onSave({ ...row, enabled: !row.enabled })}
            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
              row.enabled
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {row.enabled ? "enabled" : "disabled"}
          </button>
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex justify-end gap-2">
            {!isDefault && (
              <button
                onClick={onMakeDefault}
                disabled={disabled || !row.enabled}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Make default
              </button>
            )}
            <button
              onClick={() => setOpen((v) => !v)}
              disabled={disabled}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {open ? "Close" : "Edit"}
            </button>
            <button
              onClick={onDelete}
              disabled={disabled}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-gray-50">
          <td colSpan={4} className="bg-gray-50 px-5 py-4">
            <ModelFields value={edit} onChange={setEdit} lockKey />
            <button
              onClick={async () => {
                if (await onSave(edit)) setOpen(false);
              }}
              disabled={disabled}
              className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save changes
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
