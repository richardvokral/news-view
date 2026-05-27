import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listModels, upsertModel } from "@/lib/proofread/store";
import type { ProofreadModel } from "@/lib/proofread/types";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return {
      denied: NextResponse.json({ error: "Admin required" }, { status: 403 }),
    };
  }
  return { email: session.email };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const models = await listModels();
  return NextResponse.json({ models });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as Partial<ProofreadModel>;
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!key || !modelId) {
      return NextResponse.json(
        { error: "key and modelId are required" },
        { status: 400 }
      );
    }
    const model: ProofreadModel = {
      key,
      provider: body.provider === "anthropic" ? "anthropic" : "openai",
      modelId,
      label: typeof body.label === "string" ? body.label : key,
      enabled: body.enabled !== false,
      inputUsdPerMtok:
        typeof body.inputUsdPerMtok === "number" && body.inputUsdPerMtok >= 0
          ? body.inputUsdPerMtok
          : 0,
      outputUsdPerMtok:
        typeof body.outputUsdPerMtok === "number" && body.outputUsdPerMtok >= 0
          ? body.outputUsdPerMtok
          : 0,
      sortOrder:
        typeof body.sortOrder === "number" ? Math.trunc(body.sortOrder) : 0,
    };
    await upsertModel(model);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
