"use client";

import { useCallback, useState } from "react";
import type { InsightsConfig } from "@/lib/insights/types";
import type { AiModel } from "@/lib/ai/models";

interface Suggestion {
  token: string;
  count: number;
  share: number;
  known: boolean;
}

function NumberField({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export default function InsightsConfigForm({
  initial,
  sites,
  models,
}: {
  initial: InsightsConfig;
  sites: string[];
  models: AiModel[];
}) {
  const [config, setConfig] = useState<InsightsConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverSite, setDiscoverSite] = useState(sites[0] ?? "");

  function setField<K extends keyof InsightsConfig>(
    key: K,
    value: InsightsConfig[K]
  ) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/insights/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        // Adopt the echoed config so server-side clamping shows up.
        setConfig(data.config);
        setMessage({ type: "success", text: "Uloženo" });
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Uložení selhalo",
        });
      } finally {
        setSaving(false);
      }
    },
    [config]
  );

  const discover = useCallback(async () => {
    if (!discoverSite) return;
    setDiscovering(true);
    try {
      const res = await fetch(
        `/api/admin/insights/section-suggestions?site=${encodeURIComponent(discoverSite)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Načtení selhalo",
      });
    } finally {
      setDiscovering(false);
    }
  }, [discoverSite]);

  function toggleToken(token: string) {
    const set = new Set(config.sectionVocabulary);
    if (set.has(token)) set.delete(token);
    else set.add(token);
    setField("sectionVocabulary", [...set].sort());
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Načítání dat</h2>
        <p className="mb-4 text-xs text-gray-500">
          Načítání běží po částech, aby se vešlo do limitu serverless funkce.
          Limit Plausible (600 req/h) je sdílený s monitorem.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label="Týdnů zpět"
            hint="26 ≈ půl roku"
            value={config.backfillWeeks}
            min={1}
            onChange={(v) => setField("backfillWeeks", v)}
          />
          <NumberField
            label="Týdnů na požadavek"
            hint="Menší číslo = kratší požadavky"
            value={config.weeksPerRequest}
            min={1}
            onChange={(v) => setField("weeksPerRequest", v)}
          />
          <NumberField
            label="Max. volání na běh"
            value={config.maxRequestsPerRun}
            min={1}
            onChange={(v) => setField("maxRequestsPerRun", v)}
          />
          <NumberField
            label="Řádků na stránku"
            hint="Max 1000 (limit Plausible)"
            value={config.pageLimit}
            min={100}
            onChange={(v) => setField("pageLimit", v)}
          />
          <NumberField
            label="Max. stránek na týden"
            value={config.maxPagesPerWeek}
            min={1}
            onChange={(v) => setField("maxPagesPerWeek", v)}
          />
          <NumberField
            label="Doběh týdne (h)"
            hint="Po této době se poslední týden načte naposled"
            value={config.refetchGraceHours}
            min={0}
            onChange={(v) => setField("refetchGraceHours", v)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Rozpoznání článků</h2>
        <p className="mb-4 text-xs text-gray-500">
          Filtr se posílá Plausible (šetří volání), regulární výraz rozhoduje
          lokálně, co se uloží. Skupiny výrazu: 1 = krátké ID, 2 = slug.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Filtr cesty (Plausible)
            </span>
            <input
              value={config.articlePathFilter}
              onChange={(e) => setField("articlePathFilter", e.target.value)}
              placeholder="/a/**"
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Prázdné = načítat vše a filtrovat až lokálně.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Regulární výraz cesty
            </span>
            <input
              value={config.articlePathRegex}
              onChange={(e) => setField("articlePathRegex", e.target.value)}
              placeholder="^/a/([^/]+)/([^/?#]+)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Prázdné = výchozí <code>^/a/(id)/(slug)</code>.
            </span>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Rubriky</h2>
        <p className="mb-4 text-xs text-gray-500">
          Ze slugu se jako rubriky berou nejvýše dvě úvodní slova, a jen pokud
          jsou v tomto seznamu. Bez seznamu by se první slova titulku
          považovala za rubriky.
        </p>

        <textarea
          value={config.sectionVocabulary.join("\n")}
          onChange={(e) =>
            setField(
              "sectionVocabulary",
              e.target.value
                .split("\n")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            )
          }
          rows={6}
          placeholder={"zpravy\ndomov\nsvet\nsport\nkultura"}
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              Najít v datech
            </span>
            {sites.length > 1 && (
              <select
                value={discoverSite}
                onChange={(e) => setDiscoverSite(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                {sites.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={discover}
              disabled={discovering || !discoverSite}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {discovering ? "Hledám…" : "Navrhnout"}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Nejčastější úvodní slova ve slugách načtených článků. Kliknutím je
            přidáte nebo odeberete ze seznamu výše.
          </p>

          {suggestions && suggestions.length === 0 && (
            <p className="mt-3 text-xs text-gray-500">
              Zatím nejsou načtená žádná data.
            </p>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => {
                const active = config.sectionVocabulary.includes(s.token);
                return (
                  <button
                    key={s.token}
                    type="button"
                    onClick={() => toggleToken(s.token)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-blue-300 bg-blue-100 text-blue-800"
                        : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                    title={`${s.count}× (${Math.round(s.share * 100)} %)`}
                  >
                    {s.token}
                    <span className="ml-1 text-gray-400">{s.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">AI analýza</h2>
        <p className="mb-4 text-xs text-gray-500">
          Model se bere ze společného katalogu (Admin → AI Proofreading →
          Models). Uživatel si ho může u jednotlivé analýzy přepnout.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Výchozí model
            </span>
            <select
              value={config.aiModelKey ?? ""}
              onChange={(e) => setField("aiModelKey", e.target.value || null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">(výchozí model aplikace)</option>
              {models
                .filter((m) => m.enabled)
                .map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
            </select>
          </label>
          <NumberField
            label="Článků do analýzy"
            hint="Víc článků = přesnější témata i vyšší cena"
            value={config.aiTopArticles}
            min={20}
            onChange={(v) => setField("aiTopArticles", v)}
          />
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Ukládám…" : "Uložit"}
        </button>
        {config.updatedBy && config.updatedAt && (
          <span className="text-xs text-gray-500">
            Naposledy {config.updatedBy},{" "}
            {new Date(config.updatedAt).toLocaleString("cs-CZ")}
          </span>
        )}
      </div>
    </form>
  );
}
