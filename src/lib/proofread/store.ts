import { getDb, hasDb } from "@/lib/db";
import type {
  ProofreadModel,
  ProofreadPrompt,
  ProofreadUserConfig,
  Provider,
} from "./types";

// ---- Models ---------------------------------------------------------------

interface ModelRow {
  key: string;
  provider: string;
  model_id: string;
  label: string;
  enabled: boolean;
  input_usd_per_mtok: string | number;
  output_usd_per_mtok: string | number;
  sort_order: number;
}

function toProvider(value: string): Provider {
  return value === "anthropic" ? "anthropic" : "openai";
}

function rowToModel(r: ModelRow): ProofreadModel {
  return {
    key: r.key,
    provider: toProvider(r.provider),
    modelId: r.model_id,
    label: r.label,
    enabled: r.enabled,
    inputUsdPerMtok: Number(r.input_usd_per_mtok),
    outputUsdPerMtok: Number(r.output_usd_per_mtok),
    sortOrder: r.sort_order,
  };
}

const MODEL_COLUMNS = `key, provider, model_id, label, enabled,
  input_usd_per_mtok, output_usd_per_mtok, sort_order`;

export async function listModels(): Promise<ProofreadModel[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<ModelRow>(
    `SELECT ${MODEL_COLUMNS} FROM proofread_models
      ORDER BY sort_order ASC, key ASC`
  );
  return rows.map(rowToModel);
}

export async function getModel(key: string): Promise<ProofreadModel | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<ModelRow>(
    `SELECT ${MODEL_COLUMNS} FROM proofread_models WHERE key = $1`,
    [key]
  );
  return rows.length ? rowToModel(rows[0]) : null;
}

export async function upsertModel(m: ProofreadModel): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const key = m.key.trim();
  if (!key) throw new Error("Model key required");
  const modelId = m.modelId.trim();
  if (!modelId) throw new Error("Model id required");
  await getDb().query(
    `INSERT INTO proofread_models
       (key, provider, model_id, label, enabled,
        input_usd_per_mtok, output_usd_per_mtok, sort_order, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (key) DO UPDATE SET
       provider = EXCLUDED.provider,
       model_id = EXCLUDED.model_id,
       label = EXCLUDED.label,
       enabled = EXCLUDED.enabled,
       input_usd_per_mtok = EXCLUDED.input_usd_per_mtok,
       output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
       sort_order = EXCLUDED.sort_order,
       updated_at = NOW()`,
    [
      key,
      toProvider(m.provider),
      modelId,
      m.label.trim() || key,
      m.enabled,
      m.inputUsdPerMtok,
      m.outputUsdPerMtok,
      m.sortOrder,
    ]
  );
}

export async function deleteModel(key: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(`DELETE FROM proofread_models WHERE key = $1`, [key]);
}

export async function getDefaultModelKey(): Promise<string | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ default_model_key: string | null }>(
    `SELECT default_model_key FROM proofread_settings WHERE id = 1`
  );
  return rows.length ? rows[0].default_model_key : null;
}

export async function setDefaultModelKey(
  email: string,
  key: string
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(
    `INSERT INTO proofread_settings (id, default_model_key, updated_by, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       default_model_key = EXCLUDED.default_model_key,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [key, email]
  );
}

// ---- Prompts --------------------------------------------------------------

interface PromptRow {
  mode: string;
  label: string;
  body: string;
  is_default_mode: boolean;
}

function rowToPrompt(r: PromptRow): ProofreadPrompt {
  return {
    mode: r.mode,
    label: r.label,
    body: r.body,
    isDefaultMode: r.is_default_mode,
  };
}

export async function listPrompts(): Promise<ProofreadPrompt[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<PromptRow>(
    `SELECT mode, label, body, is_default_mode FROM proofread_prompts
      ORDER BY mode ASC`
  );
  return rows.map(rowToPrompt);
}

export async function getPrompt(mode: string): Promise<ProofreadPrompt | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<PromptRow>(
    `SELECT mode, label, body, is_default_mode FROM proofread_prompts
      WHERE mode = $1`,
    [mode]
  );
  return rows.length ? rowToPrompt(rows[0]) : null;
}

export async function getDefaultMode(): Promise<string | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ mode: string }>(
    `SELECT mode FROM proofread_prompts
      ORDER BY is_default_mode DESC, mode ASC LIMIT 1`
  );
  return rows.length ? rows[0].mode : null;
}

export async function upsertPrompt(
  email: string,
  p: ProofreadPrompt
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const mode = p.mode.trim();
  if (!mode) throw new Error("Mode required");
  const body = p.body.trim();
  if (!body) throw new Error("Prompt body required");
  const db = getDb();
  if (p.isDefaultMode) {
    // Only one mode can be the default.
    await db.query(
      `UPDATE proofread_prompts SET is_default_mode = false WHERE mode <> $1`,
      [mode]
    );
  }
  await db.query(
    `INSERT INTO proofread_prompts (mode, label, body, is_default_mode, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (mode) DO UPDATE SET
       label = EXCLUDED.label,
       body = EXCLUDED.body,
       is_default_mode = EXCLUDED.is_default_mode,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [mode, p.label.trim() || mode, body, p.isDefaultMode, email]
  );
}

// ---- Per-user config ------------------------------------------------------

interface UserConfigRow {
  email: string;
  model_key: string | null;
  prompt_override: string | null;
}

export async function getUserConfig(
  email: string
): Promise<ProofreadUserConfig | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<UserConfigRow>(
    `SELECT email, model_key, prompt_override FROM proofread_user_config
      WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  if (rows.length === 0) return null;
  return {
    email: rows[0].email,
    modelKey: rows[0].model_key,
    promptOverride: rows[0].prompt_override,
  };
}

export async function listUserConfigs(): Promise<
  (ProofreadUserConfig & { modelLabel: string | null })[]
> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<
    UserConfigRow & { model_label: string | null }
  >(
    `SELECT c.email, c.model_key, c.prompt_override, m.label AS model_label
       FROM proofread_user_config c
       LEFT JOIN proofread_models m ON m.key = c.model_key
      ORDER BY c.email ASC`
  );
  return rows.map((r) => ({
    email: r.email,
    modelKey: r.model_key,
    promptOverride: r.prompt_override,
    modelLabel: r.model_label,
  }));
}

export async function upsertUserConfig(c: ProofreadUserConfig): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const email = c.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Invalid email");
  const modelKey = c.modelKey?.trim() || null;
  const promptOverride = c.promptOverride?.trim() || null;
  await getDb().query(
    `INSERT INTO proofread_user_config (email, model_key, prompt_override, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) DO UPDATE SET
       model_key = EXCLUDED.model_key,
       prompt_override = EXCLUDED.prompt_override,
       updated_at = NOW()`,
    [email, modelKey, promptOverride]
  );
}

export async function deleteUserConfig(email: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(`DELETE FROM proofread_user_config WHERE email = $1`, [
    email.trim().toLowerCase(),
  ]);
}
