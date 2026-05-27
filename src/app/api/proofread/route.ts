import { NextRequest } from "next/server";
import { getApiConfig } from "@/lib/storage/settings";
import { requireExtensionUser } from "@/lib/proofread/auth";
import { corsJson, corsPreflight } from "@/lib/proofread/cors";
import { resolveConfig, ProofreadConfigError } from "@/lib/proofread/router";
import { runOpenAI } from "@/lib/proofread/openai";
import { runAnthropic } from "@/lib/proofread/anthropic";
import { estimateCost, recordUsage } from "@/lib/proofread/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const gate = await requireExtensionUser(req);
  if ("denied" in gate) return gate.denied;
  const email = gate.email;

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
  const { model, prompt, mode } = resolved;

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
  try {
    const result =
      model.provider === "anthropic"
        ? await runAnthropic({
            modelId: model.modelId,
            promptBody: prompt.body,
            payload,
            apiKey,
          })
        : await runOpenAI({
            modelId: model.modelId,
            promptBody: prompt.body,
            payload,
            apiKey,
          });

    const cost = estimateCost(model, result.inputTokens, result.outputTokens);
    await recordUsage({
      email,
      provider: model.provider,
      modelId: model.modelId,
      modelKey: model.key,
      mode,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: cost.usd,
      costCzk: cost.czk,
      status: "ok",
      articleId,
      sourceUrl,
      inputChars,
    });

    return corsJson({
      title: result.title,
      bodyHtml: result.bodyHtml,
      suggestions: result.suggestions,
      summary: result.summary,
      warnings: result.warnings,
      mode,
      usage: {
        provider: model.provider,
        model: model.modelId,
        modelLabel: model.label,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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
