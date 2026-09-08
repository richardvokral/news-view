import { NextRequest } from "next/server";
import { getApiConfig } from "@/lib/storage/settings";
import { requireExtensionUser } from "@/lib/proofread/auth";
import { corsJson, corsPreflight } from "@/lib/proofread/cors";
import { resolveConfig, ProofreadConfigError } from "@/lib/proofread/router";
import { runOpenAI } from "@/lib/proofread/openai";
import { runAnthropic } from "@/lib/proofread/anthropic";
import { runKorektor, mergeSuggestions } from "@/lib/proofread/korektor";
import type { KorektorResult } from "@/lib/proofread/korektor";
import { buildKorektorHint } from "@/lib/proofread/prompts";
import { estimateCost, recordUsage } from "@/lib/proofread/usage";
import type { ProofreadResult } from "@/lib/proofread/types";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Every call is a paid LLM request, so a leaked token has a bounded blast
// radius: this many articles per hour, and this much text per article.
const REQUESTS_PER_HOUR = 60;
const MAX_INPUT_CHARS = 200_000;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const gate = await requireExtensionUser(req);
  if ("denied" in gate) return gate.denied;
  const email = gate.email;

  const limited = await rateLimit(
    `ratelimit:proofread:${email}`,
    REQUESTS_PER_HOUR,
    60 * 60
  );
  if (!limited.allowed) {
    return corsJson(
      {
        error: "Překročen hodinový limit korektur. Zkuste to později.",
        retryAfter: limited.retryAfter,
      },
      429
    );
  }

  let body: {
    mode?: unknown;
    articleId?: unknown;
    sourceUrl?: unknown;
    fields?: { title?: unknown; bodyHtml?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid JSON" }, 400);
  }

  const fields = body.fields ?? {};
  const title = typeof fields.title === "string" ? fields.title : null;
  const bodyHtml = typeof fields.bodyHtml === "string" ? fields.bodyHtml : null;
  if (!title && !bodyHtml) {
    return corsJson({ error: "Není co kontrolovat." }, 400);
  }
  const requestedMode = typeof body.mode === "string" ? body.mode : undefined;
  const articleId = typeof body.articleId === "string" ? body.articleId : null;
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : null;
  const inputChars = (title?.length ?? 0) + (bodyHtml?.length ?? 0);
  if (inputChars > MAX_INPUT_CHARS) {
    return corsJson(
      { error: "Text je příliš dlouhý pro korekturu." },
      413
    );
  }

  let resolved;
  try {
    resolved = await resolveConfig(email, requestedMode);
  } catch (e) {
    const message =
      e instanceof ProofreadConfigError
        ? e.message
        : "Konfigurace korektury selhala.";
    return corsJson({ error: message }, 503);
  }
  const { model, prompt, mode, korektor } = resolved;

  const config = await getApiConfig();
  const apiKey =
    model.provider === "anthropic"
      ? config.clustering.anthropicApiKey
      : config.clustering.openaiApiKey;
  if (!apiKey) {
    return corsJson(
      { error: `AI klíč pro ${model.provider} není nastaven.` },
      503
    );
  }

  const payload = { mode, title, bodyHtml };
  const korektorEnabled = korektor.mode !== "off";

  // Korektor never blocks the LLM: a remote failure yields empty suggestions
  // plus a warning, and we proceed with the LLM alone.
  let korektorResult: KorektorResult = {
    suggestions: [],
    acknowledgements: [],
    inputChars,
  };
  let korektorError: string | null = null;
  async function safeKorektor() {
    if (!korektorEnabled) return;
    try {
      korektorResult = await runKorektor({
        endpoint: korektor.endpoint,
        model: korektor.model,
        title,
        bodyHtml,
      });
    } catch (e) {
      korektorError = e instanceof Error ? e.message : "Korektor selhal.";
    }
  }

  function runLLM(systemSuffix?: string): Promise<ProofreadResult> {
    const opts = {
      modelId: model.modelId,
      promptBody: prompt.body,
      payload,
      apiKey: apiKey as string,
      systemSuffix,
    };
    return model.provider === "anthropic" ? runAnthropic(opts) : runOpenAI(opts);
  }

  try {
    let llmResult: ProofreadResult;
    if (korektor.mode === "sequential") {
      await safeKorektor();
      llmResult = await runLLM(buildKorektorHint(korektorResult.suggestions));
    } else if (korektor.mode === "parallel") {
      const [, r] = await Promise.all([safeKorektor(), runLLM()]);
      llmResult = r;
    } else {
      llmResult = await runLLM();
    }

    const suggestions = korektorEnabled
      ? mergeSuggestions(korektorResult.suggestions, llmResult.suggestions)
      : llmResult.suggestions;

    const warnings = [...llmResult.warnings];
    if (korektorError) warnings.push(`Korektor nedostupný: ${korektorError}`);

    const cost = estimateCost(model, llmResult.inputTokens, llmResult.outputTokens);
    await recordUsage({
      email,
      provider: model.provider,
      modelId: model.modelId,
      modelKey: model.key,
      mode,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      costUsd: cost.usd,
      costCzk: cost.czk,
      status: "ok",
      articleId,
      sourceUrl,
      inputChars,
    });
    if (korektorEnabled) {
      await recordUsage({
        email,
        provider: "korektor",
        modelId: korektor.model,
        modelKey: null,
        mode,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        costCzk: 0,
        status: korektorError ? "error" : "ok",
        articleId,
        sourceUrl,
        inputChars: korektorResult.inputChars,
      }).catch(() => {});
    }

    return corsJson({
      suggestions,
      summary: llmResult.summary,
      warnings,
      mode,
      korektor: {
        mode: korektor.mode,
        count: korektorResult.suggestions.length,
        acknowledgements: korektorResult.acknowledgements,
      },
      usage: {
        provider: model.provider,
        model: model.modelId,
        modelLabel: model.label,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        costUsd: cost.usd,
        costCzk: cost.czk,
      },
    });
  } catch (e) {
    await recordUsage({
      email,
      provider: model.provider,
      modelId: model.modelId,
      modelKey: model.key,
      mode,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costCzk: 0,
      status: "error",
      articleId,
      sourceUrl,
      inputChars,
    }).catch(() => {});
    return corsJson(
      { error: e instanceof Error ? e.message : "Korektura selhala." },
      502
    );
  }
}
