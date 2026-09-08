import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveSections } from "@/lib/access";
import { createSession } from "@/lib/proofread/auth";
import { corsJson, corsPreflight } from "@/lib/proofread/cors";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Knowing an allowed e-mail address is the only thing this endpoint asks for,
// and it hands back a 30-day token to a paid LLM API. Until a real second
// factor lands (password columns exist but are unused), two things narrow it:
//
//  1. EXTENSION_LOGIN_SECRET — when set, a shared enrolment code is also
//     required. Unset means the previous email-only behaviour, so deployments
//     keep working; set it in Vercel to close the hole.
//  2. Rate limits per IP and per e-mail, so the endpoint can't be swept for
//     valid addresses or used to mint tokens in bulk.
const IP_LIMIT = 10;
const IP_WINDOW_SECONDS = 15 * 60;
const EMAIL_LIMIT = 5;
const EMAIL_WINDOW_SECONDS = 60 * 60;

function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; secret?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; secret?: unknown };
  } catch {
    return corsJson({ error: "Invalid JSON" }, 400);
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 254) {
    return corsJson({ error: "Zadejte platný e-mail." }, 400);
  }

  const limited = await rateLimitAll([
    {
      key: `ratelimit:extlogin:ip:${clientIp(req)}`,
      limit: IP_LIMIT,
      windowSeconds: IP_WINDOW_SECONDS,
    },
    {
      key: `ratelimit:extlogin:email:${email}`,
      limit: EMAIL_LIMIT,
      windowSeconds: EMAIL_WINDOW_SECONDS,
    },
  ]);
  if (!limited.allowed) {
    return corsJson(
      {
        error: "Příliš mnoho pokusů. Zkuste to později.",
        retryAfter: limited.retryAfter,
      },
      429
    );
  }

  const requiredSecret = process.env.EXTENSION_LOGIN_SECRET;
  if (requiredSecret && !secretMatches(body.secret, requiredSecret)) {
    // Same message as an unknown e-mail: don't reveal which half was wrong.
    return corsJson({ error: "Přihlášení se nezdařilo." }, 403);
  }

  const sections = await resolveSections(email);
  if (sections.length === 0) {
    return corsJson(
      {
        error: requiredSecret
          ? "Přihlášení se nezdařilo."
          : "Tento e-mail nemá přístup ke korektuře.",
      },
      403
    );
  }
  const { token, expiresAt } = await createSession(email);
  return corsJson({ token, email, expiresAt });
}
