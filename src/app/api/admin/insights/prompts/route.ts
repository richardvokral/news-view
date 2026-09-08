import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listInsightPrompts,
  upsertInsightPrompt,
} from "@/lib/insights/promptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return { denied: NextResponse.json({ error: "Admin required" }, { status: 403 }) };
  }
  return { email: session.email };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  return NextResponse.json({ prompts: await listInsightPrompts() });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const body_ = typeof body.body === "string" ? body.body : "";
    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    if (!body_.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    await upsertInsightPrompt({
      key,
      label: typeof body.label === "string" ? body.label : key,
      body: body_,
      isDefault: body.isDefault === true,
      updatedBy: gate.email,
    });
    return NextResponse.json({ ok: true, prompts: await listInsightPrompts() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
