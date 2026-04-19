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

export async function getSession(): Promise<Session> {
  try {
    const ctx = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
    const rawEmail = ctx.userInfo?.email ?? ctx.claims?.email;
    const email =
      typeof rawEmail === "string" && rawEmail.length > 0
        ? rawEmail.toLowerCase()
        : null;
    if (!email) return { email: null, isAdmin: false, sections: [] };
    const admin = isAdmin(email);
    // Admins get every section; non-admins go through email -> domain -> deny.
    const sections = admin ? [...ALL_SECTIONS] : await resolveSections(email);
    return { email, isAdmin: admin, sections };
  } catch {
    return { email: null, isAdmin: false, sections: [] };
  }
}
