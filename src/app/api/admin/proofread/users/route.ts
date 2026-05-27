import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listUserConfigs, upsertUserConfig } from "@/lib/proofread/store";

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
  const configs = await listUserConfigs();
  return NextResponse.json({ configs });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as {
      email?: unknown;
      modelKey?: unknown;
      promptOverride?: unknown;
    };
    const email = typeof body.email === "string" ? body.email : "";
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    await upsertUserConfig({
      email,
      modelKey: typeof body.modelKey === "string" ? body.modelKey : null,
      promptOverride:
        typeof body.promptOverride === "string" ? body.promptOverride : null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
