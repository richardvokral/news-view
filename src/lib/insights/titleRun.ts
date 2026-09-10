import { getApiConfig } from "@/lib/storage/settings";
import { listAiModels, estimateCost, type AiModel } from "@/lib/ai/models";
import { getDefaultModelKey } from "@/lib/proofread/store";
import { getInsightsConfig, recordAnalysisRun } from "./store";
import {
  getDefaultInsightPrompt,
  getInsightPrompt,
  getPlaybookRules,
  type InsightPrompt,
} from "./promptStore";
import {
  listTitleCohorts,
  toCohortArticles,
  type CohortRow,
} from "./titleAnalysis";
import { runTitleAnalysisCall, runRewriteCall } from "./titleProviders";
import { sanitizeSubmittedTitle } from "./titlePrompts";
import { COHORT_LABELS, type TitleCohort } from "./titlePrompts";
import type { AnalysisScope } from "./types";

export class TitleRunError extends Error {}

async function resolveModel(requested?: string | null): Promise<AiModel> {
  const models = (await listAiModels()).filter((m) => m.enabled);
  if (models.length === 0) {
    throw new TitleRunError("Není nakonfigurován žádný AI model.");
  }
  if (requested) {
    const picked = models.find((m) => m.key === requested);
    if (picked) return picked;
  }
  const config = await getInsightsConfig();
  if (config.aiModelKey) {
    const picked = models.find((m) => m.key === config.aiModelKey);
    if (picked) return picked;
  }
  const appDefault = await getDefaultModelKey();
  if (appDefault) {
    const picked = models.find((m) => m.key === appDefault);
    if (picked) return picked;
  }
  return models[0];
}

async function apiKeyFor(provider: string): Promise<string> {
  const cfg = await getApiConfig();
  const key =
    provider === "anthropic"
      ? cfg.clustering.anthropicApiKey
      : cfg.clustering.openaiApiKey;
  if (!key) throw new TitleRunError(`AI klíč pro ${provider} není nastaven.`);
  return key;
}

// --- Title analysis ---------------------------------------------------------

export interface TitlePattern {
  label: string;
  cohort: "vitezove" | "propadaky";
  formNote: string;
  titleCount: number;
  /** Median of ln(pv / bucket median) across the pattern's members. */
  medianLogRatio: number | null;
  medianRatio: number | null;
  /** Share of the pattern's members whose title came from a URL slug. */
  slugShare: number;
  cohortMix: { cohort: TitleCohort; count: number }[];
  examples: { pagePath: string; headline: string }[];
}

export interface TitleAnalysisResult {
  scope: {
    siteId: string;
    weekStartFrom: string;
    weekStartTo: string;
    tailWeeks: number;
    minPageviews: number;
    cohortSize: number;
    population: number;
    titleBackedShare: number;
    excludedTruncatedWeeks: string[];
  };
  cohortCounts: { cohort: TitleCohort; label: string; count: number }[];
  patterns: TitlePattern[];
  contrastNote: string;
  playbookDraft: string;
  observations: string[];
  reconciliation: {
    assigned: number;
    unassigned: number;
    total: number;
    droppedIndexes: number[];
  };
  caveats: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface TitleAnalysisInput {
  siteId: string;
  weekStartFrom: string;
  weekStartTo: string;
  perCohort: number;
  promptKey?: string | null;
  modelKey?: string | null;
  email: string;
}

export async function runTitleAnalysis(input: TitleAnalysisInput) {
  const started = Date.now();
  const config = await getInsightsConfig();

  const selection = await listTitleCohorts({
    siteId: input.siteId,
    weekStartFrom: input.weekStartFrom,
    weekStartTo: input.weekStartTo,
    tailWeeks: config.titleTailWeeks,
    minPageviews: config.titleMinPageviews,
    perCohort: input.perCohort,
  });

  if (selection.rows.length < 20) {
    throw new TitleRunError(
      "Pro zvolené období není dost načtených článků na rozbor titulků. Načtěte víc týdnů v záložce Články."
    );
  }

  const prompt =
    (input.promptKey ? await getInsightPrompt(input.promptKey) : null) ??
    (await getDefaultInsightPrompt("analysis"));
  if (!prompt) throw new TitleRunError("Není nakonfigurován žádný prompt.");

  const model = await resolveModel(input.modelKey);
  const apiKey = await apiKeyFor(model.provider);
  const articles = toCohortArticles(selection.rows);
  const byIdx = new Map(articles.map((a) => [a.idx, a]));
  const rowByPath = new Map(selection.rows.map((r) => [r.pagePath, r]));

  const scopeLabel = `${input.weekStartFrom} – ${input.weekStartTo}`;
  const call = await runTitleAnalysisCall({
    provider: model.provider,
    modelId: model.modelId,
    apiKey,
    promptBody: prompt.body,
    articles,
    scopeLabel,
  });

  // Same discipline as the theme analysis: the model supplies labels and
  // membership, the server computes every number from the rows.
  const claimed = new Set<number>();
  const droppedIndexes: number[] = [];
  const patterns: TitlePattern[] = call.raw.patterns.map((p) => {
    const members: CohortRow[] = [];
    for (const idx of p.article_indexes) {
      const article = byIdx.get(idx);
      if (!article) {
        droppedIndexes.push(idx);
        continue;
      }
      claimed.add(idx);
      const row = rowByPath.get(article.pagePath);
      if (row) members.push(row);
    }
    const logs = members
      .map((m) => m.logRatio)
      .filter((v): v is number => v !== null);
    const med = median(logs);
    const slugCount = members.filter((m) => m.headlineSource === "slug").length;
    const mix = new Map<TitleCohort, number>();
    for (const m of members) {
      for (const c of m.cohorts) mix.set(c, (mix.get(c) ?? 0) + 1);
    }
    return {
      label: p.label,
      cohort: p.cohort,
      formNote: p.form_note,
      titleCount: members.length,
      medianLogRatio: med === null ? null : round(med, 3),
      medianRatio: med === null ? null : round(Math.exp(med)),
      slugShare:
        members.length > 0
          ? round((slugCount / members.length) * 100, 1)
          : 0,
      cohortMix: [...mix.entries()].map(([cohort, count]) => ({ cohort, count })),
      examples: members
        .slice(0, 3)
        .map((m) => ({ pagePath: m.pagePath, headline: m.headline })),
    };
  });

  const cohortCounts = (
    [
      "normalizovani_vitezove",
      "normalizovani_propadaky",
      "absolutni_vitezove",
      "absolutni_propadaky",
    ] as TitleCohort[]
  ).map((cohort) => ({
    cohort,
    label: COHORT_LABELS[cohort],
    count: selection.rows.filter((r) => r.cohorts.includes(cohort)).length,
  }));

  const caveats: string[] = [];
  if (selection.titleBackedShare < 60) {
    caveats.push(
      `Jen ${selection.titleBackedShare} % titulků je skutečných — zbytek je rekonstruovaný z URL, bez diakritiky a interpunkce. Závěry o otaznících, uvozovkách a velkých písmenech z takového vzorku neplatí. Doplňte titulky v Adminu → Insights.`
    );
  }
  if (selection.excludedTruncatedWeeks.length > 0) {
    caveats.push(
      `Vynecháno ${selection.excludedTruncatedWeeks.length} neúplně načtených týdnů: u nich chybí právě nejméně čtené články, což by rozbor propadáků obrátilo naruby.`
    );
  }
  const weakBuckets = selection.rows.filter(
    (r) => r.bucketLevel === "week"
  ).length;
  if (weakBuckets > 0) {
    caveats.push(
      `U ${weakBuckets} článků byla rubrika příliš malá na vlastní srovnání, porovnávaly se proti celému týdnu — u nich se vliv tématu neodfiltroval.`
    );
  }

  const result: TitleAnalysisResult = {
    scope: {
      siteId: input.siteId,
      weekStartFrom: input.weekStartFrom,
      weekStartTo: input.weekStartTo,
      tailWeeks: config.titleTailWeeks,
      minPageviews: config.titleMinPageviews,
      cohortSize: selection.cohortSize,
      population: selection.population,
      titleBackedShare: selection.titleBackedShare,
      excludedTruncatedWeeks: selection.excludedTruncatedWeeks,
    },
    cohortCounts,
    patterns: patterns.sort((a, b) => b.titleCount - a.titleCount),
    contrastNote: call.raw.contrast_note,
    playbookDraft: call.raw.playbook_draft,
    observations: call.raw.notes ?? [],
    reconciliation: {
      assigned: claimed.size,
      unassigned: articles.length - claimed.size,
      total: articles.length,
      droppedIndexes: [...new Set(droppedIndexes)],
    },
    caveats,
  };

  const cost = estimateCost(model, call.inputTokens, call.outputTokens);
  const params: AnalysisScope = {
    siteId: input.siteId,
    weekStartFrom: input.weekStartFrom,
    weekStartTo: input.weekStartTo,
    sections: [],
    includePartialWeeks: false,
    rankBy: "pageviews",
    topN: input.perCohort,
  };
  const runId = await recordAnalysisRun({
    siteId: input.siteId,
    params,
    promptKey: prompt.key,
    promptBody: prompt.body,
    modelKey: model.key,
    provider: model.provider,
    modelId: model.modelId,
    status: "ok",
    // Stored under the shared run history; `kind` separates it from themes.
    result: result as unknown as never,
    error: null,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: cost.usd,
    costCzk: cost.czk,
    durationMs: Date.now() - started,
    createdBy: input.email,
    kind: "titles",
  });

  return {
    runId,
    result,
    model: { key: model.key, label: model.label, modelId: model.modelId },
    costCzk: cost.czk,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

// --- Rewriter ---------------------------------------------------------------

export interface RewriteVariant {
  title: string;
  appliedRules: number[];
  unknownRules: number[];
  rationale: string;
  /** Digit runs in the variant that do not appear in the submitted title. */
  unverifiedNumbers: string[];
}

export interface RewriteResult {
  original: string;
  critique: string;
  brokenRules: string[];
  variants: RewriteVariant[];
  notes: string[];
  playbook: { key: string; label: string; rules: string[] };
  warnings: string[];
}

const PREDICTION_PHRASES = [
  "ctenost",
  "čtenost",
  "prokliku",
  "ctr",
  "vyšší výkon",
  "bude fungovat lépe",
  "získá víc",
  "zaujme víc",
];

/** Digit runs, so a fabricated figure in a variant is visible. */
function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

export interface RewriteRunInput {
  siteId: string;
  title: string;
  section?: string | null;
  perex?: string | null;
  playbookKey: string;
  modelKey?: string | null;
  email: string;
}

export async function runTitleRewrite(input: RewriteRunInput) {
  const started = Date.now();
  const title = sanitizeSubmittedTitle(input.title);
  if (!title) throw new TitleRunError("Zadejte titulek.");

  const playbook: InsightPrompt | null = await getInsightPrompt(
    input.playbookKey
  );
  if (!playbook || playbook.kind !== "title_rewrite") {
    throw new TitleRunError("Vyberte uložený playbook.");
  }
  const rules = getPlaybookRules(playbook.body);
  if (rules.length === 0) {
    throw new TitleRunError("Playbook neobsahuje žádná pravidla.");
  }

  const model = await resolveModel(input.modelKey);
  const apiKey = await apiKeyFor(model.provider);

  const call = await runRewriteCall({
    provider: model.provider,
    modelId: model.modelId,
    apiKey,
    rules,
    input: {
      title,
      section: input.section ?? null,
      perex: input.perex ?? null,
    },
  });

  // The server enforces; the model advises. Nothing here is verifiable against
  // stored rows, so these checks are the only guarantee behind the promise
  // that the rewriter never invents a performance claim.
  const warnings: string[] = [];
  const originalDigits = new Set(digitRuns(title));
  const variants: RewriteVariant[] = call.raw.variants.map((v) => {
    const applied: number[] = [];
    const unknown: number[] = [];
    for (const id of v.rule_ids) {
      if (id >= 1 && id <= rules.length) applied.push(id);
      else unknown.push(id);
    }
    const unverified = digitRuns(v.title).filter((d) => !originalDigits.has(d));
    return {
      title: v.title,
      appliedRules: applied,
      unknownRules: unknown,
      rationale: v.rationale,
      unverifiedNumbers: unverified,
    };
  });

  const prose = [
    call.raw.critique,
    ...call.raw.broken_rules,
    ...variants.map((v) => v.rationale),
    ...(call.raw.notes ?? []),
  ].join(" \n");
  if (/\d/.test(prose)) {
    warnings.push(
      "Model uvedl v odůvodnění číslo. Žádná predikce výkonu není podložená daty — ignorujte ji."
    );
  }
  const lowered = prose.toLowerCase();
  if (PREDICTION_PHRASES.some((p) => lowered.includes(p))) {
    warnings.push(
      "Odůvodnění obsahuje tvrzení o čtenosti. Nástroj nemá data o výkonu navržených titulků."
    );
  }
  if (variants.some((v) => v.unknownRules.length > 0)) {
    warnings.push(
      "Model se odvolal na pravidlo, které v playbooku není. Takové odkazy byly vyřazeny."
    );
  }
  if (variants.some((v) => v.unverifiedNumbers.length > 0)) {
    warnings.push(
      "Některá varianta obsahuje číslo, které v původním titulku není. Ověřte ho v článku."
    );
  }

  const result: RewriteResult = {
    original: title,
    critique: call.raw.critique,
    brokenRules: call.raw.broken_rules,
    variants,
    notes: call.raw.notes ?? [],
    playbook: { key: playbook.key, label: playbook.label, rules },
    warnings,
  };

  const cost = estimateCost(model, call.inputTokens, call.outputTokens);
  await recordAnalysisRun({
    siteId: input.siteId,
    params: {
      siteId: input.siteId,
      weekStartFrom: "",
      weekStartTo: "",
      sections: [],
      includePartialWeeks: false,
      rankBy: "pageviews",
      topN: 0,
    },
    promptKey: playbook.key,
    promptBody: playbook.body,
    modelKey: model.key,
    provider: model.provider,
    modelId: model.modelId,
    status: "ok",
    result: result as unknown as never,
    error: null,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: cost.usd,
    costCzk: cost.czk,
    durationMs: Date.now() - started,
    createdBy: input.email,
    kind: "rewrite",
  }).catch(() => null);

  return { result, model: { key: model.key, label: model.label }, costCzk: cost.czk };
}
