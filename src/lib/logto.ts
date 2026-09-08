import type { LogtoNextConfig } from "@logto/next";
import { getLogtoContext } from "@logto/next/server-actions";
import { resolveSections, isAdmin } from "./access";
import { ALL_SECTIONS, type Section } from "@/types/dashboard";

export const logtoConfig: LogtoNextConfig = {
  endpoint: process.env.LOGTO_ENDPOINT!,
  appId: process.env.LOGTO_APP_ID!,
  appSecret: process.env.LOGTO_APP_SECRET!,
  baseUrl: process.env.LOGTO_BASE_URL!,
  cookieSecret: process.env.LOGTO_COOKIE_SECRET!,
  cookieSecure: process.env.NODE_ENV === "production",
  scopes: ["email"],
};

export interface Session {
  email: string | null;
  isAdmin: boolean;
  sections: Section[];
}

const ANONYMOUS: Session = { email: null, isAdmin: false, sections: [] };

export interface SessionOptions {
  /**
   * Read the email from the verified ID-token claims instead of calling
   * Logto's /userinfo endpoint. Same trust level — the session cookie is
   * decrypted and verified either way — but it saves an HTTP round-trip per
   * request. Use it on hot paths (`/api/plausible` is hit 10+ times per
   * dashboard render); leave it off elsewhere so a user whose email only
   * lives in userinfo still resolves.
   */
  fromClaimsOnly?: boolean;
}

type EmailLookup = { authenticated: boolean; email: string | null };

async function readEmail(fetchUserInfo: boolean): Promise<EmailLookup> {
  const ctx = await getLogtoContext(logtoConfig, { fetchUserInfo });
  if (!ctx.isAuthenticated) return { authenticated: false, email: null };
  const rawEmail = ctx.userInfo?.email ?? ctx.claims?.email;
  const email =
    typeof rawEmail === "string" && rawEmail.length > 0
      ? rawEmail.toLowerCase()
      : null;
  return { authenticated: true, email };
}

export async function getSession(
  options: SessionOptions = {}
): Promise<Session> {
  try {
    const first = await readEmail(!options.fromClaimsOnly);
    let email = first.email;
    // Signed in but no email in the ID token (a tenant that doesn't put it
    // there) would otherwise lock everyone out of the claims-only routes —
    // pay for /userinfo rather than deny. Not authenticated means no retry:
    // /userinfo can't produce an email either.
    if (first.authenticated && !email && options.fromClaimsOnly) {
      email = (await readEmail(true)).email;
    }
    if (!email) return ANONYMOUS;
    const admin = isAdmin(email);
    // Admins get every section; non-admins go through email -> domain -> deny.
    const sections = admin ? [...ALL_SECTIONS] : await resolveSections(email);
    return { email, isAdmin: admin, sections };
  } catch {
    return ANONYMOUS;
  }
}
