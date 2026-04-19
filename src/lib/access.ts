import { getDb, hasDb } from "./db";
import { ALL_SECTIONS, type Section } from "@/types/dashboard";

export type { Section };
export { ALL_SECTIONS };

function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.toLowerCase());
}

function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set<string>(ALL_SECTIONS);
  return raw
    .map((s) => (typeof s === "string" ? s.toLowerCase() : null))
    .filter((s): s is Section => s !== null && valid.has(s));
}

async function fetchUserSections(email: string): Promise<Section[] | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ sections: string[] }>(
    "SELECT sections FROM access_users WHERE email = $1",
    [email.toLowerCase()]
  );
  if (rows.length === 0) return null;
  return normalizeSections(rows[0].sections);
}

async function fetchDomainSections(domain: string): Promise<Section[] | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ sections: string[] }>(
    "SELECT sections FROM access_domains WHERE domain = $1",
    [domain.toLowerCase()]
  );
  if (rows.length === 0) return null;
  return normalizeSections(rows[0].sections);
}

/**
 * Admins get all sections. Otherwise an exact email row wins (even empty),
 * then the email's domain, else no access.
 */
export async function resolveSections(email: string): Promise<Section[]> {
  if (isAdmin(email)) return [...ALL_SECTIONS];
  const userSections = await fetchUserSections(email);
  if (userSections !== null) return userSections;
  const at = email.indexOf("@");
  if (at < 0) return [];
  const domain = email.slice(at + 1).toLowerCase();
  const domainSections = await fetchDomainSections(domain);
  return domainSections ?? [];
}

export interface AccessUserRow {
  email: string;
  sections: Section[];
  updatedAt: string;
}

export interface AccessDomainRow {
  domain: string;
  sections: Section[];
  updatedAt: string;
}

export async function listAccessUsers(): Promise<AccessUserRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<{
    email: string;
    sections: string[];
    updated_at: string;
  }>("SELECT email, sections, updated_at FROM access_users ORDER BY email ASC");
  return rows.map((r) => ({
    email: r.email,
    sections: normalizeSections(r.sections),
    updatedAt: r.updated_at,
  }));
}

export async function upsertAccessUser(
  email: string,
  sections: Section[]
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@")) throw new Error("Invalid email");
  const validSet = new Set<string>(ALL_SECTIONS);
  const normalized = sections.filter((s) => validSet.has(s));
  await getDb().query(
    `INSERT INTO access_users (email, sections)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET sections = EXCLUDED.sections, updated_at = NOW()`,
    [clean, normalized]
  );
}

export async function deleteAccessUser(email: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query("DELETE FROM access_users WHERE email = $1", [
    email.toLowerCase(),
  ]);
}

export async function listAccessDomains(): Promise<AccessDomainRow[]> {
  if (!hasDb()) return [];
  const { rows } = await getDb().query<{
    domain: string;
    sections: string[];
    updated_at: string;
  }>(
    "SELECT domain, sections, updated_at FROM access_domains ORDER BY domain ASC"
  );
  return rows.map((r) => ({
    domain: r.domain,
    sections: normalizeSections(r.sections),
    updatedAt: r.updated_at,
  }));
}

export async function upsertAccessDomain(
  domain: string,
  sections: Section[]
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  const clean = domain.trim().replace(/^@/, "").toLowerCase();
  if (!clean || clean.includes("@") || !clean.includes(".")) {
    throw new Error("Invalid domain (use e.g. example.com)");
  }
  const validSet = new Set<string>(ALL_SECTIONS);
  const normalized = sections.filter((s) => validSet.has(s));
  await getDb().query(
    `INSERT INTO access_domains (domain, sections)
     VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE
       SET sections = EXCLUDED.sections, updated_at = NOW()`,
    [clean, normalized]
  );
}

export async function deleteAccessDomain(domain: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query("DELETE FROM access_domains WHERE domain = $1", [
    domain.toLowerCase(),
  ]);
}
