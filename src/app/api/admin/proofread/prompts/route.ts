import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listPrompts, upsertPrompt } from "@/lib/proofread/store";
import type { ProofreadPrompt } from "@/lib/proofread/types";

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
  const prompts = await listPrompts();
  return NextResponse.json({ prompts });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as Partial<ProofreadPrompt>;
    const mode = typeof body.mode === "string" ? body.mode.trim() : "";
    const promptBody = typeof body.body === "string" ? body.body : "";
    if (!mode || !promptBody.trim()) {
      return NextResponse.json(
        { error: "mode and body are required" },
        { status: 400 }
      );
    }
    await upsertPrompt(gate.email, {
      mode,
      label: typeof body.label === "string" ? body.label : mode,
      body: promptBody,
      isDefaultMode: body.isDefaultMode === true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
