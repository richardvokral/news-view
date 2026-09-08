import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cancelBackfill } from "@/lib/insights/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { runKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const runKey = typeof body.runKey === "string" ? body.runKey.trim() : "";
  if (!runKey) {
    return NextResponse.json({ error: "runKey is required" }, { status: 400 });
  }

  // Checked between weeks, so an in-flight week still commits as a unit.
  await cancelBackfill(runKey.slice(0, 64));
  return NextResponse.json({ ok: true });
}
