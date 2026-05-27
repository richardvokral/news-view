import { NextRequest } from "next/server";
import { resolveSections } from "@/lib/access";
import { requireExtensionUser } from "@/lib/proofread/auth";
import { corsJson, corsPreflight } from "@/lib/proofread/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: NextRequest) {
  const gate = await requireExtensionUser(req);
  if ("denied" in gate) return gate.denied;
  const sections = await resolveSections(gate.email);
  return corsJson({ email: gate.email, sections });
}
