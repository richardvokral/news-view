"use client";

import { useState } from "react";
import type { KorektorConfig, KorektorMode, Suggestion } from "@/lib/proofread/types";

interface Props {
  initial: KorektorConfig;
}

const MODES: { value: KorektorMode; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "LLM only (default)." },
  {
    value: "parallel",
    label: "Parallel",
    desc: "Korektor and the LLM run together; results are merged and deduped. Lower latency.",
  },
  {
    value: "sequential",
    label: "Sequential",
    desc: "Korektor runs first; its fixes are passed to the LLM so it doesn't repeat them. Cleaner, but slower.",
  },
];

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelCls = "mb-1 block text-xs font-medium uppercase text-gray-500";

interface TestResult {
  ok: boolean;
  sample?: string;
  suggestions?: Suggestion[];
  acknowledgements?: string[];
  error?: string;
}

export default function ProofreadKorektorForm({ initial }: Props) {
  const [config, setConfig] = useState<KorektorConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/proofread/korektor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setConfig(data.config);
      setMessage({ type: "success", text: "Saved." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/proofread/korektor/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: config.endpoint,
          model: config.model,
        }),
      });
      const data = (await res.json()) as TestResult;
      setTest(data);
    } catch (err) {
      setTest({
        ok: false,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* License notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">Licence — přečtěte před produkčním použitím</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Hostovaná LINDAT API je dle podmínek pro „osobní, nekomerční
            použití“. Komerční nasazení (korektura produkčních článků)
            <strong> vyžaduje písemnou dohodu s ÚFAL</strong> (model je pod CC
            BY-NC-SA, kód pod BSD-2).
          </li>
          <li>
            Hostovaná služba může <strong>uchovávat odeslaný text</strong> pro
            zlepšování systému — neposílejte nepublikovaný citlivý obsah, dokud
            nemáte dohodu / vlastní server.
          </li>
          <li>
            Pro produkci doporučeno self-hostovat <code>korektor_server</code> a
            nasměrovat na něj Endpoint URL níže.
          </li>
        </ul>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <span className={labelCls}>Mode</span>
          <div className="space-y-2">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="korektor-mode"
                  className="mt-0.5"
                  checked={config.mode === m.value}
                  onChange={() => setConfig({ ...config, mode: m.value })}
                />
                <span>
                  <span className="font-medium text-gray-900">{m.label}</span>
                  <span className="text-gray-500"> — {m.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Endpoint URL</label>
            <input
              className={inputCls}
              value={config.endpoint}
              onChange={(e) =>
                setConfig({ ...config, endpoint: e.target.value })
              }
              placeholder="https://lindat.mff.cuni.cz/services/korektor/api"
            />
          </div>
          <div>
            <label className={labelCls}>Model</label>
            <input
              className={inputCls}
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="czech-spellchecker"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={runTest}
            disabled={testing}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          {message && (
            <span
              className={`text-sm ${
                message.type === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>

      {test && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Test result
          </h2>
          {!test.ok ? (
            <p className="text-sm text-red-600">{test.error}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-gray-500">
                Sample: <span className="font-mono">{test.sample}</span>
              </p>
              {test.suggestions && test.suggestions.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {test.suggestions.map((s, i) => (
                    <li key={i}>
                      <span className="rounded bg-red-50 px-1 text-red-700 line-through">
                        {s.original}
                      </span>{" "}
                      →{" "}
                      <span className="rounded bg-green-50 px-1 text-green-700">
                        {s.replacement}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">
                  No suggestions returned (check endpoint / model).
                </p>
              )}
              {test.acknowledgements && test.acknowledgements.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                  <p className="font-medium">Acknowledgements (keep visible):</p>
                  {test.acknowledgements.map((a) => (
                    <div key={a}>
                      <a
                        href={a}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {a}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
