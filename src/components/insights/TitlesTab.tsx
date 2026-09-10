"use client";

import { useCallback, useState } from "react";
import type { TitleAnalysisResult } from "@/lib/insights/titleRun";

const fmt = new Intl.NumberFormat("cs-CZ");

function weekOffset(weeks: number): string {
  const d = new Date();
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift - weeks * 7);
  return d.toISOString().slice(0, 10);
}

export default function TitlesTab({
  site,
  prompts,
  models,
  defaultModelKey,
  onPlaybookSaved,
}: {
  site: string;
  prompts: { key: string; label: string }[];
  models: { key: string; label: string }[];
  defaultModelKey: string | null;
  onPlaybookSaved: () => void;
}) {
  const [weeks, setWeeks] = useState(13);
  const [perCohort, setPerCohort] = useState(60);
  const [promptKey, setPromptKey] = useState(
    prompts.find((p) => p.key === "titulky_rozbor")?.key ?? prompts[0]?.key ?? ""
  );
  const [modelKey, setModelKey] = useState(defaultModelKey ?? models[0]?.key ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TitleAnalysisResult | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [meta, setMeta] = useState<{ label: string; costCzk: number } | null>(null);

  const [draft, setDraft] = useState("");
  const [playbookName, setPlaybookName] = useState("");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/insights/title-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          from: weekOffset(weeks),
          to: weekOffset(1),
          perCohort,
          promptKey: promptKey || undefined,
          modelKey: modelKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data.result);
      setRunId(data.runId ?? null);
      setDraft(data.result?.playbookDraft ?? "");
      setPlaybookName(`Titulky ${new Date().toLocaleDateString("cs-CZ")}`);
      setMeta({ label: data.model?.label ?? "", costCzk: data.costCzk ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [site, weeks, perCohort, promptKey, modelKey]);

  const savePlaybook = useCallback(async () => {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/insights/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          label: playbookName,
          body: draft,
          shared,
          runId,
          isDefault: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.lines?.length
            ? `${data.error} (${data.lines.join(" / ")})`
            : data.error || `HTTP ${res.status}`
        );
      }
      setSaveMsg("Playbook uložen — použijete ho v záložce Přepsat titulek.");
      onPlaybookSaved();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [site, playbookName, draft, shared, runId, onPlaybookSaved]);

  return (
    <div>
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Období</span>
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {[8, 13, 26, 52].map((w) => (
                <option key={w} value={w}>Posledních {w} týdnů</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Titulků ve skupině</span>
            <select value={perCohort} onChange={(e) => setPerCohort(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {[30, 60, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Prompt</span>
            <select value={promptKey} onChange={(e) => setPromptKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {prompts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Model</span>
            <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={run} disabled={running || models.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
            {running ? "Analyzuji…" : "Rozebrat titulky"}
          </button>
          {meta && !running && (
            <span className="text-xs text-gray-500">{meta.label} · {meta.costCzk.toFixed(2)} Kč</span>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Porovnávají se dvě dvojice: <strong>normalizovaná</strong> (článek proti mediánu své rubriky
          v týdnu, kdy vyšel — tam se pozná vliv titulku) a <strong>absolutní</strong> (nejčtenější
          a nejméně čtené celkově — tam se často pozná spíš vliv tématu).
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-6">
          {result.caveats.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-medium uppercase text-amber-800">Jak číst tento rozbor</div>
              <ul className="mt-1 space-y-1">
                {result.caveats.map((c, i) => (
                  <li key={i} className="text-sm text-amber-900">{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {result.cohortCounts.map((c) => (
              <div key={c.cohort} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-gray-500">{c.label}</div>
                <div className="mt-0.5 text-lg font-semibold text-gray-900">{c.count}</div>
              </div>
            ))}
          </div>

          {result.contrastNote && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs font-medium uppercase text-blue-700">Titulek vs. téma</div>
              <p className="mt-1 text-sm text-blue-900">{result.contrastNote}</p>
            </div>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Vzory v titulcích</h3>
            <div className="space-y-3">
              {result.patterns.map((p, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{p.label}</h4>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          p.cohort === "vitezove"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {p.cohort === "vitezove" ? "u úspěšných" : "u propadáků"}
                        </span>
                      </div>
                      {p.formNote && <p className="mt-1 text-sm text-gray-600">{p.formNote}</p>}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-gray-900">
                        {p.medianRatio === null ? "—" : `${p.medianRatio}×`}
                      </div>
                      <div className="text-xs text-gray-500">
                        medián vs. rubrika · {p.titleCount} titulků
                      </div>
                    </div>
                  </div>
                  {p.slugShare > 40 && (
                    <p className="mt-2 text-xs text-amber-700">
                      {p.slugShare} % titulků v tomto vzoru je z URL — bez interpunkce a diakritiky.
                    </p>
                  )}
                  {p.examples.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {p.examples.map((e) => (
                        <li key={e.pagePath} className="truncate text-xs text-gray-600">{e.headline}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Playbook pro psaní titulků</h3>
            <p className="mt-1 text-xs text-gray-500">
              Vygenerováno z nalezených vzorů. Upravte podle sebe a uložte — pak podle něj
              přepisujete titulky v další záložce. Pravidla nesmí obsahovat čísla.
            </p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10}
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input value={playbookName} onChange={(e) => setPlaybookName(e.target.value)}
                placeholder="Název playbooku"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                sdílet napříč weby
              </label>
              <button type="button" onClick={savePlaybook} disabled={saving || !draft.trim()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Ukládám…" : "Uložit jako playbook"}
              </button>
            </div>
            {saveMsg && <p className="mt-2 text-xs text-green-700">{saveMsg}</p>}
            {saveErr && <p className="mt-2 text-xs text-red-700">{saveErr}</p>}
          </section>

          <details className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">Kontrola úplnosti</summary>
            <p className="mt-2">
              Zařazeno {result.reconciliation.assigned} z {result.reconciliation.total} titulků.
              Všechna čísla výše počítá systém z databáze; model dodává jen pojmenování vzorů,
              zařazení titulků a text.
              {result.reconciliation.droppedIndexes.length > 0 && (
                <> Model uvedl {result.reconciliation.droppedIndexes.length} neplatných odkazů, byly vyřazeny.</>
              )}
              {" "}Populace období: {fmt.format(result.scope.population)} článků.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
