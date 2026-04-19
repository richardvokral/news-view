"use client";

import { useState } from "react";
import { ALL_SECTIONS, type AccessUserRow, type Section } from "@/lib/access";

interface Props {
  initial: AccessUserRow[];
}

export default function AllowedUsersTable({ initial }: Props) {
  const [rows, setRows] = useState<AccessUserRow[]>(initial);
  const [email, setEmail] = useState("");
  const [sections, setSections] = useState<Section[]>(["reports", "news"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSection(s: Section) {
    setSections((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function addOrUpdate(emailVal: string, sectionVals: Section[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal, sections: sectionVals }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      const listRes = await fetch("/api/admin/users");
      const data = await listRes.json();
      setRows(data.users || []);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(emailVal: string) {
    if (!confirm(`Remove ${emailVal}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(emailVal)}`,
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
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) return;
          addOrUpdate(email, sections);
        }}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Sections
            </span>
            <div className="flex gap-3">
              {ALL_SECTIONS.map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-1.5 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={sections.includes(s)}
                    onChange={() => toggleSection(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !email}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add / Update"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Sections</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-5 py-10 text-center text-sm text-gray-400"
                >
                  No allowed users yet. Domain rules still apply.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <UserRow
                  key={row.email}
                  row={row}
                  onUpdate={(sectionVals) =>
                    addOrUpdate(row.email, sectionVals)
                  }
                  onDelete={() => remove(row.email)}
                  disabled={saving}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  row,
  onUpdate,
  onDelete,
  disabled,
}: {
  row: AccessUserRow;
  onUpdate: (sections: Section[]) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [sections, setSections] = useState<Section[]>(row.sections);
  const dirty = sections.sort().join(",") !== row.sections.slice().sort().join(",");

  function toggle(s: Section) {
    setSections((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-5 py-3 font-mono text-xs text-gray-800">{row.email}</td>
      <td className="px-5 py-3">
        <div className="flex gap-3">
          {ALL_SECTIONS.map((s) => (
            <label
              key={s}
              className="flex items-center gap-1.5 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={sections.includes(s)}
                onChange={() => toggle(s)}
              />
              {s}
            </label>
          ))}
        </div>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          {dirty && (
            <button
              onClick={() => onUpdate(sections)}
              disabled={disabled}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={disabled}
            className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}
