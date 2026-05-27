import { getDb, hasDb } from "@/lib/db";
import type { ProofreadModel } from "./types";

export const USD_TO_CZK = Number(process.env.USD_TO_CZK ?? "23");

export function estimateCost(
  model: ProofreadModel,
  inputTokens: number,
  outputTokens: number
): { usd: number; czk: number } {
  const usd =
    (inputTokens / 1_000_000) * model.inputUsdPerMtok +
    (outputTokens / 1_000_000) * model.outputUsdPerMtok;
  return { usd, czk: usd * USD_TO_CZK };
}

export interface UsageRecord {
  email: string;
  provider: string;
  modelId: string;
  modelKey: string | null;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCzk: number;
  status: string;
  articleId: string | null;
  sourceUrl: string | null;
  inputChars: number;
}

export async function recordUsage(u: UsageRecord): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `INSERT INTO proofread_usage
       (email, provider, model_id, model_key, mode, input_tokens, output_tokens,
        cost_usd, cost_czk, status, article_id, source_url, input_chars)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      u.email,
      u.provider,
      u.modelId,
      u.modelKey,
      u.mode,
      u.inputTokens,
      u.outputTokens,
      u.costUsd,
      u.costCzk,
      u.status,
      u.articleId,
      u.sourceUrl,
      u.inputChars,
    ]
  );
}

export interface UsageByUser {
  email: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCzk: number;
}

export interface UsageByModel {
  modelKey: string | null;
  modelId: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costCzk: number;
}

interface AggRow {
  requests: string | number;
  input_tokens: string | number;
  output_tokens: string | number;
  cost_usd: string | number;
  cost_czk: string | number;
}

export async function aggregateByUser(): Promise<UsageByUser[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<AggRow & { email: string }>(
    `SELECT email,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(cost_czk), 0) AS cost_czk
       FROM proofread_usage
      GROUP BY email
      ORDER BY cost_usd DESC`
  );
  return rows.map((r) => ({
    email: r.email,
    requests: Number(r.requests),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd),
    costCzk: Number(r.cost_czk),
  }));
}

export async function aggregateByModel(): Promise<UsageByModel[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<
    AggRow & { model_key: string | null; model_id: string; provider: string }
  >(
    `SELECT model_key, model_id, provider,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(cost_czk), 0) AS cost_czk
       FROM proofread_usage
      GROUP BY model_key, model_id, provider
      ORDER BY cost_usd DESC`
  );
  return rows.map((r) => ({
    modelKey: r.model_key,
    modelId: r.model_id,
    provider: r.provider,
    requests: Number(r.requests),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd),
    costCzk: Number(r.cost_czk),
  }));
}
