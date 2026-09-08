import { getApiConfig } from "@/lib/storage/settings";
import { listAiModels, estimateCost, type AiModel } from "@/lib/ai/models";
import { getDefaultModelKey } from "@/lib/proofread/store";
import {
  getInsightsConfig,
  listArticles,
  listWeeklyTotalsForPaths,
  recordAnalysisRun,
  toAggregatedArticles,
  listWeekLedger,
} from "./store";
import { getDefaultInsightPrompt, getInsightPrompt } from "./promptStore";
import { groundAnalysis } from "./ground";
import { runAnthropicAnalysis, runOpenAiAnalysis } from "./providers";
import type { AnalysisScope, InsightRunResult, MetricTier } from "./types";

export class InsightsAnalysisError extends Error {}

export interface AnalyzeInput {
  scope: AnalysisScope;
  promptKey?: string | null;
  modelKey?: string | null;
  email: string;
}

export interface AnalyzeOutput {
  runId: number | null;
  result: InsightRunResult;
  model: { key: string; provider: string; modelId: string; label: string };
  promptKey: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCzk: number;
  durationMs: number;
}

/**
 * Model resolution mirrors src/lib/proofread/router.ts: explicit choice, then
 * the insights default, then the app-wide default, then the first enabled
 * model. Never a hardcoded id — a disabled model is silently skipped.
 */
async function resolveModel(requested?: string | null): Promise<AiModel> {
  const models = (await listAiModels()).filter((m) => m.enabled);
  if (models.length === 0) {
    throw new InsightsAnalysisError("Není nakonfigurován žádný AI model.");
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

function scopeLabel(scope: AnalysisScope): string {
  const base = `${scope.weekStartFrom} – ${scope.weekStartTo}`;
  if (scope.sections.length > 0) return `${base}, rubriky: ${scope.sections.join(", ")}`;
  return base;
}

export async function runInsightsAnalysis(
  input: AnalyzeInput
): Promise<AnalyzeOutput> {
  const started = Date.now();
  const config = await getInsightsConfig();

  const topN = Math.min(
    Math.max(20, input.scope.topN || config.aiTopArticles),
    600
  );
  const scope: AnalysisScope = { ...input.scope, topN };

  const prompt = input.promptKey
    ? (await getInsightPrompt(input.promptKey)) ??
      (await getDefaultInsightPrompt())
    : await getDefaultInsightPrompt();
  if (!prompt) {
    throw new InsightsAnalysisError("Není nakonfigurován žádný prompt.");
  }

  const model = await resolveModel(input.modelKey);
  const apiConfig = await getApiConfig();
  const apiKey =
    model.provider === "anthropic"
      ? apiConfig.clustering.anthropicApiKey
      : apiConfig.clustering.openaiApiKey;
  if (!apiKey) {
    throw new InsightsAnalysisError(
      `AI klíč pro ${model.provider} není nastaven.`
    );
  }

  const rows = await listArticles({
    siteId: scope.siteId,
    weekStartFrom: scope.weekStartFrom,
    weekStartTo: scope.weekStartTo,
    sections: scope.sections,
    includePartialWeeks: scope.includePartialWeeks,
    rankBy: scope.rankBy,
    limit: topN,
  });
  if (rows.length === 0) {
    throw new InsightsAnalysisError(
      "Pro zvolené období nejsou v databázi žádná data. Načtěte je nejdřív tlačítkem Načíst data."
    );
  }

  const articles = toAggregatedArticles(rows);
  const weekly = await listWeeklyTotalsForPaths(
    scope.siteId,
    articles.map((a) => a.pagePath),
    scope.weekStartFrom,
    scope.weekStartTo,
    scope.includePartialWeeks
  );

  const ledger = await listWeekLedger(scope.siteId);
  const metricsTierSeen: MetricTier | null =
    ledger.find((r) => r.metricsTier !== null)?.metricsTier ?? null;

  const callOpts = {
    modelId: model.modelId,
    promptBody: prompt.body,
    articles,
    scopeLabel: scopeLabel(scope),
    apiKey,
  };

  try {
    const call =
      model.provider === "anthropic"
        ? await runAnthropicAnalysis(callOpts)
        : await runOpenAiAnalysis(callOpts);

    const result = groundAnalysis({
      scope,
      metricsTierSeen,
      articles,
      weekly,
      raw: call.raw,
    });

    const cost = estimateCost(model, call.inputTokens, call.outputTokens);
    const durationMs = Date.now() - started;

    const runId = await recordAnalysisRun({
      siteId: scope.siteId,
      params: scope,
      promptKey: prompt.key,
      promptBody: prompt.body,
      modelKey: model.key,
      provider: model.provider,
      modelId: model.modelId,
      status: "ok",
      result,
      error: null,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: cost.usd,
      costCzk: cost.czk,
      durationMs,
      createdBy: input.email,
    });

    return {
      runId,
      result,
      model: {
        key: model.key,
        provider: model.provider,
        modelId: model.modelId,
        label: model.label,
      },
      promptKey: prompt.key,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: cost.usd,
      costCzk: cost.czk,
      durationMs,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordAnalysisRun({
      siteId: scope.siteId,
      params: scope,
      promptKey: prompt.key,
      promptBody: prompt.body,
      modelKey: model.key,
      provider: model.provider,
      modelId: model.modelId,
      status: "error",
      result: null,
      error: message,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costCzk: 0,
      durationMs: Date.now() - started,
      createdBy: input.email,
    }).catch(() => null);
    throw e;
  }
}
