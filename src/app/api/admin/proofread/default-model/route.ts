import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDefaultModelKey, setDefaultModelKey } from "@/lib/proofread/store";

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
  const key = await getDefaultModelKey();
  return NextResponse.json({ defaultModelKey: key });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as { key?: unknown };
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key) {
      return NextResponse.json({ error: "key required" }, { status: 400 });
    }
    await setDefaultModelKey(gate.email, key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
