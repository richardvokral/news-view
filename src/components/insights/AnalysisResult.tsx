"use client";

import type { InsightRunResult } from "@/lib/insights/types";

const fmt = new Intl.NumberFormat("cs-CZ");

const TREND_LABEL: Record<string, string> = {
  rising: "roste",
  flat: "drží se",
  declining: "klesá",
};
const TREND_CLASS: Record<string, string> = {
  rising: "bg-green-100 text-green-700",
  flat: "bg-gray-100 text-gray-600",
  declining: "bg-amber-100 text-amber-700",
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-6 items-end gap-0.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1 rounded-sm bg-blue-400"
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
          title={fmt.format(v)}
        />
      ))}
    </div>
  );
}

export default function AnalysisResult({
  result,
}: {
  result: InsightRunResult;
}) {
  const { reconciliation: rec } = result;

  return (
    <div className="space-y-6">
      {result.takeaway && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-xs font-medium uppercase text-blue-700">
            Shrnutí
          </div>
          <p className="mt-1 text-sm text-blue-900">{result.takeaway}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Článků", value: fmt.format(result.totals.articles) },
          { label: "Zobrazení", value: fmt.format(result.totals.pageviews) },
          { label: "Témat", value: String(result.themes.length) },
          { label: "Týdnů", value: String(result.totals.weeks) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
          >
            <div className="text-xs uppercase text-gray-500">{s.label}</div>
            <div className="mt-0.5 text-lg font-semibold text-gray-900">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Témata</h3>
        <div className="space-y-3">
          {result.themes.map((t) => (
            <div
              key={t.themeId}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{t.name}</h4>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${TREND_CLASS[t.trend]}`}
                    >
                      {TREND_LABEL[t.trend]}
                    </span>
                  </div>
                  {t.summary && (
                    <p className="mt-1 text-sm text-gray-600">{t.summary}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 text-right">
                  <Sparkline values={t.weeklyPageviews.map((w) => w.pageviews)} />
                  <div>
                    <div className="text-sm font-semibold tabular-nums text-gray-900">
                      {fmt.format(t.pageviewsSum)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t.shareOfPageviews}% · {t.articleCount} čl.
                    </div>
                  </div>
                </div>
              </div>

              {t.whyItWorked && (
                <p className="mt-2 border-l-2 border-gray-200 pl-3 text-sm text-gray-600">
                  {t.whyItWorked}
                </p>
              )}

              {t.articles.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {t.articles.slice(0, 3).map((a) => (
                    <li key={a.pagePath} className="flex gap-2 text-xs">
                      <span className="tabular-nums text-gray-500">
                        {fmt.format(a.pageviews)}
                      </span>
                      <span className="truncate text-gray-700">{a.headline}</span>
                    </li>
                  ))}
                  {t.articles.length > 3 && (
                    <li className="text-xs text-gray-400">
                      + {t.articles.length - 3} dalších
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {result.headlinePatterns.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Vzory titulků
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Vzor</th>
                  <th className="px-3 py-2 text-right font-medium">Článků</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Ø zobrazení
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Rozdíl</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.headlinePatterns.map((p) => (
                  <tr key={p.label}>
                    <td className="px-3 py-2">
                      <div className="text-gray-900">{p.label}</div>
                      {p.note && (
                        <div className="text-xs text-gray-500">{p.note}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {p.articleCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {fmt.format(p.avgPageviews)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium ${
                        p.liftPct >= 0 ? "text-green-700" : "text-amber-700"
                      }`}
                    >
                      {p.liftPct >= 0 ? "+" : ""}
                      {p.liftPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Vzory pojmenoval model, čísla dopočítal systém z databáze. Rozdíl je
            proti průměru všech analyzovaných článků.
            {result.scope.titleBackedShare < 100 && (
              <>
                {" "}
                U {100 - result.scope.titleBackedShare}% článků je titulek
                odvozený z URL (bez diakritiky a interpunkce), takže rozpoznání
                otázek a citací je u nich slabší.
              </>
            )}
          </p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Rubriky</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Rubrika</th>
                <th className="px-3 py-2 text-right font-medium">Článků</th>
                <th className="px-3 py-2 text-right font-medium">Zobrazení</th>
                <th className="px-3 py-2 text-right font-medium">Ø na článek</th>
                <th className="px-3 py-2 text-right font-medium">Podíl</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.sections.map((s) => (
                <tr key={s.section}>
                  <td className="px-3 py-2 text-gray-900">{s.section}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {s.articleCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {fmt.format(s.pageviewsSum)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {fmt.format(s.avgPageviews)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {s.shareOfPageviews}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {result.recommendations.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Doporučení
          </h3>
          <ul className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            {result.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-gray-400">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.observations.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Poznámky</h3>
          <ul className="space-y-1.5 text-sm text-gray-600">
            {result.observations.map((o, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-700">
          Kontrola úplnosti
        </summary>
        <p className="mt-2">
          Zařazeno {rec.assigned} z {rec.total} článků, nezařazeno{" "}
          {rec.unassigned} ({fmt.format(result.unassigned.pageviewsSum)}{" "}
          zobrazení). Součet vždy odpovídá celku — všechna čísla výše počítá
          systém z databáze, model dodává jen pojmenování a text.
          {rec.droppedIndexes.length > 0 && (
            <> Model uvedl {rec.droppedIndexes.length} neplatných odkazů, byly vyřazeny.</>
          )}
          {rec.duplicateIndexes.length > 0 && (
            <> {rec.duplicateIndexes.length} článků bylo uvedeno vícekrát, započítány jednou.</>
          )}
        </p>
      </details>
    </div>
  );
}
