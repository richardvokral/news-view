import { getDb, hasDb } from "@/lib/db";
import { DEFAULT_INSIGHTS_PROMPTS } from "./prompts";

export interface InsightPrompt {
  key: string;
  label: string;
  body: string;
  isDefault: boolean;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

function rowToPrompt(r: Record<string, unknown>): InsightPrompt {
  return {
    key: String(r.key),
    label: String(r.label ?? ""),
    body: String(r.body ?? ""),
    isDefault: !!r.is_default,
    version: Number(r.version) || 1,
    updatedBy: (r.updated_by as string) ?? null,
    updatedAt: r.updated_at
      ? r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : String(r.updated_at)
      : null,
  };
}

/**
 * Seeded from TypeScript rather than db-schema.sql on purpose: the migrator
 * splits statements on a line-ending `;` and strips `--` to end of line, so a
 * Czech prompt body sitting in SQL is a migration break waiting to happen.
 * Bound parameters have no such problem.
 */
export async function ensureDefaultPrompts(): Promise<void> {
  if (!hasDb()) return;
  const db = getDb();
  for (const p of DEFAULT_INSIGHTS_PROMPTS) {
    await db.query(
      `INSERT INTO insights_prompts (key, label, body, is_default)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [p.key, p.label, p.body, p.isDefault]
    );
  }
}

export async function listInsightPrompts(): Promise<InsightPrompt[]> {
  if (!hasDb()) return [];
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT key, label, body, is_default, version, updated_by, updated_at
       FROM insights_prompts ORDER BY is_default DESC, key ASC`
  );
  return rows.map(rowToPrompt);
}

export async function getInsightPrompt(
  key: string
): Promise<InsightPrompt | null> {
  if (!hasDb()) return null;
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT key, label, body, is_default, version, updated_by, updated_at
       FROM insights_prompts WHERE key = $1`,
    [key]
  );
  return rows.length ? rowToPrompt(rows[0]) : null;
}

export async function getDefaultInsightPrompt(): Promise<InsightPrompt | null> {
  if (!hasDb()) return null;
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT key, label, body, is_default, version, updated_by, updated_at
       FROM insights_prompts ORDER BY is_default DESC, key ASC LIMIT 1`
  );
  return rows.length ? rowToPrompt(rows[0]) : null;
}

export async function upsertInsightPrompt(
  p: Omit<InsightPrompt, "version" | "updatedAt"> & { updatedBy: string }
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const key = p.key.trim();
  if (!key) throw new Error("Prompt key is required");
  if (!p.body.trim()) throw new Error("Prompt body is required");

  const db = getDb();
  await db.query(
    `INSERT INTO insights_prompts (key, label, body, is_default, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (key) DO UPDATE SET
       label = EXCLUDED.label,
       body = EXCLUDED.body,
       is_default = EXCLUDED.is_default,
       version = insights_prompts.version + 1,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [key, p.label.trim() || key, p.body.trim(), p.isDefault, p.updatedBy]
  );
  if (p.isDefault) {
    await db.query(
      `UPDATE insights_prompts SET is_default = false WHERE key <> $1`,
      [key]
    );
  }
}
