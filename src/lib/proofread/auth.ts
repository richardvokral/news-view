import { randomBytes, createHash } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "@/lib/db";
import { resolveSections } from "@/lib/access";
import { corsJson } from "./cors";

const SESSION_TTL_DAYS = 30;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ExtSession {
  email: string;
  sessionId: number;
}

export async function createSession(
  email: string
): Promise<{ token: string; expiresAt: string }> {
  if (!hasDb()) throw new Error("Database not configured");
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  await getDb().query(
    `INSERT INTO proofread_sessions (email, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [email.trim().toLowerCase(), tokenHash, expiresAt]
  );
  return { token, expiresAt };
}

export async function verifyBearer(
  authHeader: string | null
): Promise<ExtSession | null> {
  if (!authHeader || !hasDb()) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;
  const tokenHash = hashToken(match[1].trim());
  const { rows } = await getDb().query<{ id: number; email: string }>(
    `SELECT id, email FROM proofread_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  if (rows.length === 0) return null;
  // Best-effort last-used bump; never block the request on it.
  getDb()
    .query(`UPDATE proofread_sessions SET last_used_at = NOW() WHERE id = $1`, [
      rows[0].id,
    ])
    .catch(() => {});
  return { email: rows[0].email, sessionId: rows[0].id };
}

export async function revokeSession(token: string): Promise<void> {
  if (!hasDb()) return;
  await getDb().query(
    `UPDATE proofread_sessions SET revoked_at = NOW() WHERE token_hash = $1`,
    [hashToken(token)]
  );
}

/**
 * Gate for the extension token path. Verifies the bearer token AND re-checks
 * resolveSections on every request, so revoking a user's access (in
 * access_users / access_domains) immediately blocks their token.
 */
export async function requireExtensionUser(
  req: NextRequest
): Promise<{ email: string } | { denied: NextResponse }> {
  const session = await verifyBearer(req.headers.get("authorization"));
  if (!session) {
    return { denied: corsJson({ error: "Unauthorized" }, 401) };
  }
  const sections = await resolveSections(session.email);
  if (sections.length === 0) {
    return { denied: corsJson({ error: "No access" }, 403) };
  }
  return { email: session.email };
}
