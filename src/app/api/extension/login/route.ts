import { NextRequest } from "next/server";
import { resolveSections } from "@/lib/access";
import { createSession } from "@/lib/proofread/auth";
import { corsJson, corsPreflight } from "@/lib/proofread/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return corsJson({ error: "Invalid JSON" }, 400);
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return corsJson({ error: "Zadejte platný e-mail." }, 400);
  }
  const sections = await resolveSections(email);
  if (sections.length === 0) {
    return corsJson({ error: "Tento e-mail nemá přístup ke korektuře." }, 403);
  }
  const { token, expiresAt } = await createSession(email);
  return corsJson({ token, email, expiresAt });
}
