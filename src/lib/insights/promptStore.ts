import { getDb, hasDb } from "@/lib/db";
import { DEFAULT_INSIGHTS_PROMPTS } from "./prompts";

/** `analysis` drives a Themes/Titles run; `title_rewrite` is a saved playbook. */
export type PromptKind = "analysis" | "title_rewrite";

export interface InsightPrompt {
  key: string;
  label: string;
  body: string;
  kind: PromptKind;
  /** null = shared across sites. Playbooks are normally site-scoped. */
  siteId: string | null;
  derivedFromRunId: number | null;
  isDefault: boolean;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

const PROMPT_COLUMNS =
  "key, label, body, kind, site_id, derived_from_run_id, is_default, version, updated_by, updated_at";

/**
 * Playbook keys are namespaced so one site's rules can't collide with
 * another's while `key` stays the primary key.
 */
export function playbookKey(siteId: string | null, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `title:${siteId ?? "shared"}:${slug || "playbook"}`;
}

function rowToPrompt(r: Record<string, unknown>): InsightPrompt {
  return {
    key: String(r.key),
    label: String(r.label ?? ""),
    body: String(r.body ?? ""),
    kind: r.kind === "title_rewrite" ? "title_rewrite" : "analysis",
    siteId: (r.site_id as string) ?? null,
    derivedFromRunId:
      r.derived_from_run_id === null || r.derived_from_run_id === undefined
        ? null
        : Number(r.derived_from_run_id),
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
      `INSERT INTO insights_prompts (key, label, body, is_default, kind)
       VALUES ($1, $2, $3, $4, 'analysis')
       ON CONFLICT (key) DO NOTHING`,
      [p.key, p.label, p.body, p.isDefault]
    );
  }
}

export async function listInsightPrompts(
  kind: PromptKind = "analysis"
): Promise<InsightPrompt[]> {
  if (!hasDb()) return [];
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT ${PROMPT_COLUMNS} FROM insights_prompts
      WHERE kind = $1
      ORDER BY is_default DESC, key ASC`,
    [kind]
  );
  return rows.map(rowToPrompt);
}

/**
 * Playbooks usable for a site: its own first, then shared ones.
 *
 * Rules measured on one masthead's audience shouldn't quietly drive another's
 * headlines, so site-scoped entries sort ahead of shared ones and the UI picks
 * the first as its default.
 */
export async function listPlaybooksForSite(
  siteId: string
): Promise<InsightPrompt[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query(
    `SELECT ${PROMPT_COLUMNS} FROM insights_prompts
      WHERE kind = 'title_rewrite'
        AND (site_id = $1 OR site_id IS NULL)
      ORDER BY (site_id IS NULL) ASC, is_default DESC, updated_at DESC`,
    [siteId]
  );
  return rows.map(rowToPrompt);
}

export async function getInsightPrompt(
  key: string
): Promise<InsightPrompt | null> {
  if (!hasDb()) return null;
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT ${PROMPT_COLUMNS} FROM insights_prompts WHERE key = $1`,
    [key]
  );
  return rows.length ? rowToPrompt(rows[0]) : null;
}

export async function getDefaultInsightPrompt(
  kind: PromptKind = "analysis"
): Promise<InsightPrompt | null> {
  if (!hasDb()) return null;
  await ensureDefaultPrompts();
  const { rows } = await getDb().query(
    `SELECT ${PROMPT_COLUMNS} FROM insights_prompts
      WHERE kind = $1
      ORDER BY is_default DESC, key ASC LIMIT 1`,
    [kind]
  );
  return rows.length ? rowToPrompt(rows[0]) : null;
}

export interface UpsertPromptInput {
  key: string;
  label: string;
  body: string;
  isDefault: boolean;
  kind?: PromptKind;
  siteId?: string | null;
  derivedFromRunId?: number | null;
  updatedBy: string;
}

export async function upsertInsightPrompt(
  p: UpsertPromptInput
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const key = p.key.trim();
  if (!key) throw new Error("Prompt key is required");
  if (!p.body.trim()) throw new Error("Prompt body is required");
  const kind: PromptKind = p.kind ?? "analysis";

  const db = getDb();
  await db.query(
    `INSERT INTO insights_prompts
       (key, label, body, kind, site_id, derived_from_run_id, is_default, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (key) DO UPDATE SET
       label = EXCLUDED.label,
       body = EXCLUDED.body,
       is_default = EXCLUDED.is_default,
       site_id = EXCLUDED.site_id,
       derived_from_run_id =
         COALESCE(EXCLUDED.derived_from_run_id, insights_prompts.derived_from_run_id),
       version = insights_prompts.version + 1,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      key,
      p.label.trim() || key,
      p.body.trim(),
      kind,
      p.siteId ?? null,
      p.derivedFromRunId ?? null,
      p.isDefault,
      p.updatedBy,
    ]
  );
  // "Default" is scoped to the kind, so making a playbook default doesn't
  // unset the default analysis prompt.
  if (p.isDefault) {
    await db.query(
      `UPDATE insights_prompts SET is_default = false
        WHERE key <> $1 AND kind = $2
          AND (site_id IS NOT DISTINCT FROM $3)`,
      [key, kind, p.siteId ?? null]
    );
  }
}

export async function deleteInsightPrompt(key: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  // Only playbooks are deletable; the seeded analysis prompts stay put.
  await getDb().query(
    `DELETE FROM insights_prompts WHERE key = $1 AND kind = 'title_rewrite'`,
    [key]
  );
}

/**
 * A playbook is stored as prose, one rule per line. Numbering them at read time
 * gives the model stable ids to cite and gives the server something to validate
 * those citations against — the same guarantee `article_indexes` provides in
 * the theme analysis.
 */
export function getPlaybookRules(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 3)
    .slice(0, 40);
}
