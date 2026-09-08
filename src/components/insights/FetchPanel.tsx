"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface WeekStatus {
  weekStart: string;
  weekEnd: string;
  complete: boolean;
  status: string;
  isPartial: boolean;
  truncated: boolean;
  rows: number;
  error: string | null;
}

interface StatusResponse {
  loaded: number;
  errored: number;
  missing: number;
  backfillWeeks: number;
  metricsTier: number | null;
  weeks: WeekStatus[];
}

interface ChunkResult {
  ok: boolean;
  runKey: string;
  remaining: number;
  refreshedCurrentWeek: boolean;
  apiCallsUsed: number;
  skippedReason?: string;
  processed: { weekStart: string; rows: number; truncated: boolean }[];
  aborted?: { weekStart: string | null; error: string };
}

const SKIP_LABELS: Record<string, string> = {
  locked: "Načítání už běží (jiné okno nebo uživatel).",
  rate_capped: "Vyčerpán hodinový limit Plausible. Zkuste to za hodinu.",
  cancelled: "Načítání zastaveno.",
  redis_unavailable: "Redis není dostupný, načítání se nespustilo.",
  not_configured: "Databáze není nakonfigurovaná.",
  no_sites: "Není nakonfigurován žádný web.",
};

export default function FetchPanel({
  site,
  weeksPerRequest,
  onLoaded,
}: {
  site: string;
  weeksPerRequest: number;
  onLoaded: () => void;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeksDone, setWeeksDone] = useState(0);
  const runKeyRef = useRef<string | null>(null);
  const stopRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/insights/backfill-status?site=${encodeURIComponent(site)}`
      );
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      // Freshness is informational; a failure here shouldn't shout.
    }
  }, [site]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // The server processes a few weeks per request and reports what's left, so
  // the client loops. A dropped response is harmless: the next call re-derives
  // the outstanding weeks from the ledger.
  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setMessage(null);
    setWeeksDone(0);
    stopRef.current = false;
    runKeyRef.current = null;

    try {
      for (;;) {
        if (stopRef.current) break;
        const res: Response = await fetch("/api/insights/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site,
            weeks: weeksPerRequest,
            ...(runKeyRef.current ? { runKey: runKeyRef.current } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as ChunkResult & {
          error?: string;
        };
        if (!res.ok) {
          setError(data.error || `HTTP ${res.status}`);
          break;
        }
        runKeyRef.current = data.runKey;
        setWeeksDone((n) => n + (data.processed?.length ?? 0));
        await loadStatus();

        if (data.aborted) {
          setError(
            `Zastaveno na týdnu ${data.aborted.weekStart ?? "?"}: ${data.aborted.error}`
          );
          break;
        }
        if (data.skippedReason) {
          setMessage(SKIP_LABELS[data.skippedReason] ?? data.skippedReason);
          break;
        }
        if (data.remaining === 0) {
          setMessage("Hotovo — všechna období jsou načtená.");
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      onLoaded();
      loadStatus();
    }
  }, [site, weeksPerRequest, loadStatus, onLoaded]);

  const stop = useCallback(async () => {
    stopRef.current = true;
    if (!runKeyRef.current) return;
    await fetch("/api/insights/backfill/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runKey: runKeyRef.current }),
    }).catch(() => {});
  }, []);

  const total = status?.backfillWeeks ?? 0;
  const loaded = status?.loaded ?? 0;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Data z Plausible</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {status
              ? `${loaded} z ${total} týdnů načteno${
                  status.errored > 0 ? ` · ${status.errored} s chybou` : ""
                }`
              : "Zjišťuji stav…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Zastavit
            </button>
          )}
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            title="Načte jen chybějící týdny; běží po částech."
          >
            {running
              ? `Načítám… (${weeksDone} týdnů)`
              : loaded === 0
                ? "Načíst data"
                : "Doplnit chybějící"}
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}
      {status && status.metricsTier !== null && status.metricsTier > 1 && (
        <p className="mt-2 text-xs text-amber-700">
          Plausible u tohoto webu nevrací metriky zapojení (bounce rate, délka
          návštěvy) na úrovni článků — ukládají se jen návštěvníci a zobrazení.
        </p>
      )}
    </div>
  );
}
