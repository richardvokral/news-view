import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getKorektorConfig, setKorektorConfig } from "@/lib/proofread/store";
import type { KorektorMode } from "@/lib/proofread/types";

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
  const config = await getKorektorConfig();
  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      endpoint?: unknown;
      model?: unknown;
    };
    const mode: KorektorMode =
      body.mode === "parallel" || body.mode === "sequential"
        ? body.mode
        : "off";
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const model = typeof body.model === "string" ? body.model : "";
    await setKorektorConfig(gate.email, { mode, endpoint, model });
    const config = await getKorektorConfig();
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
