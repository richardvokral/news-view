"use client";

import { useCallback, useEffect, useState } from "react";
import type { RewriteResult } from "@/lib/insights/titleRun";

interface Playbook {
  key: string;
  label: string;
  siteId: string | null;
  version: number;
}

export default function RewriteTab({
  site,
  models,
  defaultModelKey,
  reloadToken,
}: {
  site: string;
  models: { key: string; label: string }[];
  defaultModelKey: string | null;
  reloadToken: number;
}) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookKey, setPlaybookKey] = useState("");
  const [modelKey, setModelKey] = useState(defaultModelKey ?? models[0]?.key ?? "");
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [perex, setPerex] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadPlaybooks = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/insights/playbooks?site=${encodeURIComponent(site)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: Playbook[] = data.playbooks ?? [];
      setPlaybooks(list);
      setPlaybookKey((k) => (list.some((p) => p.key === k) ? k : list[0]?.key ?? ""));
    } catch {
      // The empty state below explains what to do.
    }
  }, [site]);

  useEffect(() => {
    loadPlaybooks();
  }, [loadPlaybooks, reloadToken]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          title,
          section: section || undefined,
          perex: perex || undefined,
          playbookKey,
          modelKey: modelKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [site, title, section, perex, playbookKey, modelKey]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be blocked; the text stays selectable either way.
    }
  }

  if (playbooks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h2 className="font-semibold text-gray-900">Zatím není uložený žádný playbook</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Přepis vychází z pravidel odvozených z vaší čtenosti. Spusťte nejdřív rozbor
          v záložce <strong>Titulky</strong> a uložte vygenerovaný playbook.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
            Navržený titulek
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300}
            placeholder="Vložte titulek, který chcete vylepšit"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </label>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Rubrika <span className="normal-case text-gray-400">(nepovinné)</span>
            </span>
            <input value={section} onChange={(e) => setSection(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block sm:col-span-3">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Perex <span className="normal-case text-gray-400">(nepovinné, zpřesní varianty)</span>
            </span>
            <textarea value={perex} onChange={(e) => setPerex(e.target.value)} rows={2} maxLength={2000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Playbook</span>
            <select value={playbookKey} onChange={(e) => setPlaybookKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {playbooks.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}{p.siteId === null ? " (sdílený)" : ""} · v{p.version}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Model</span>
            <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={run} disabled={running || !title.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {running ? "Přepisuji…" : "Navrhnout varianty"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-5">
          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-medium uppercase text-amber-800">Upozornění</div>
              <ul className="mt-1 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-900">{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.critique && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900">Původní titulek</h3>
              <p className="mt-1 text-sm text-gray-500">{result.original}</p>
              <p className="mt-2 text-sm text-gray-700">{result.critique}</p>
              {result.brokenRules.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {result.brokenRules.map((r, i) => (
                    <li key={i} className="text-xs text-amber-700">• {r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Varianty</h3>
            <div className="space-y-3">
              {result.variants.map((v, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-gray-900">{v.title}</p>
                    <button type="button" onClick={() => copy(v.title)}
                      className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                      {copied === v.title ? "Zkopírováno" : "Kopírovat"}
                    </button>
                  </div>
                  {v.rationale && <p className="mt-1.5 text-sm text-gray-600">{v.rationale}</p>}
                  {v.appliedRules.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {v.appliedRules.map((id) => (
                        <li key={id} className="text-xs text-gray-500">
                          <span className="text-gray-400">#{id}</span>{" "}
                          {result.playbook.rules[id - 1]}
                        </li>
                      ))}
                    </ul>
                  )}
                  {v.unverifiedNumbers.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Obsahuje číslo, které v původním titulku není
                      ({v.unverifiedNumbers.join(", ")}) — ověřte v článku.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-gray-500">
            Varianty vycházejí z playbooku <strong>{result.playbook.label}</strong>. Nástroj nemá
            data o výkonu navržených titulků a žádný z nich negarantuje vyšší čtenost.
          </p>
        </div>
      )}
    </div>
  );
}
