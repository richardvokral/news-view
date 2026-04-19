import fs from "fs";
import path from "path";
import { getDb, hasDb } from "./db";

/**
 * Run the idempotent DDL in src/lib/db-schema.sql.
 * All statements are CREATE ... IF NOT EXISTS, so running multiple times is safe.
 *
 * Must run in Node runtime (uses fs). Do not import from middleware/edge routes.
 */
export async function runMigrations(): Promise<
  { ok: true; statements: number } | { ok: false; error: string }
> {
  if (!hasDb()) return { ok: false, error: "DATABASE_URL not configured" };

  try {
    const sqlPath = path.join(
      process.cwd(),
      "src",
      "lib",
      "db-schema.sql"
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    const statements = splitSqlStatements(sql);
    const db = getDb();
    for (const stmt of statements) {
      await db.query(stmt);
    }
    return { ok: true, statements: statements.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.replace(/--.*$/, "");
    if (!line.trim() && !buf.trim()) continue;
    buf += line + "\n";
    if (line.trimEnd().endsWith(";")) {
      const stmt = buf.trim();
      if (stmt && stmt !== ";") out.push(stmt);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}
