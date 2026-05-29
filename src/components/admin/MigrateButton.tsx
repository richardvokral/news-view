"use client";

import { useState } from "react";

type Result =
  | { kind: "success"; statements: number }
  | { kind: "error"; text: string };

export default function MigrateButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!confirm("Run database migrations now? This applies any new schema changes.")) {
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/migrate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult({ kind: "success", statements: data.statements ?? 0 });
    } catch (err) {
      setResult({
        kind: "error",
        text: err instanceof Error ? err.message : "Migration failed",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">Only for applying new schema updates</p>
        <p className="mt-1">
          This runs the idempotent schema in <code>db-schema.sql</code> (creates
          missing tables/columns, seeds defaults). It is safe to re-run and does{" "}
          <strong>not</strong> touch existing data, but it is not part of normal
          day-to-day use — run it only after a deploy that adds new tables or
          columns.
        </p>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {running ? "Running…" : "Run migrations"}
      </button>

      {result?.kind === "success" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          ✓ Migrations applied successfully ({result.statements} statements
          executed). Your database schema is up to date.
        </div>
      )}
      {result?.kind === "error" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ✗ Migration failed: {result.text}
        </div>
      )}
    </div>
  );
}
