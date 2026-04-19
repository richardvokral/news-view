import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runMonitorTick } from "@/lib/monitor/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const result = await runMonitorTick();
  return NextResponse.json(result);
}
