import { NextRequest, NextResponse } from "next/server";
import { runMonitorTick } from "@/lib/monitor/pipeline";
import { isCronAuthorized as isAuthorized } from "@/lib/cron-auth";

// Must be Node runtime (Plausible fetch + Neon + Redis).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tick() {
  const result = await runMonitorTick();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return tick();
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return tick();
}
