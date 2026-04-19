import { NextRequest, NextResponse } from "next/server";
import { runMonitorTick } from "@/lib/monitor/pipeline";

// Must be Node runtime (Plausible fetch + Neon + Redis).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Accept either Upstash QStash's signature header presence OR a Bearer token.
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qs = request.nextUrl.searchParams.get("secret");
  if (qs === secret) return true;
  return false;
}

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
