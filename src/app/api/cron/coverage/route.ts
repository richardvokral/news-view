import { NextRequest, NextResponse } from "next/server";
import { runCoverageTick } from "@/lib/monitor/coverage";
import { listSiteIds } from "@/lib/plausible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI calls can take a while; allow up to 5 minutes.
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qs = request.nextUrl.searchParams.get("secret");
  if (qs === secret) return true;
  return false;
}

async function tick(request: NextRequest) {
  const sitesParam = request.nextUrl.searchParams.get("site");
  const sites = sitesParam
    ? sitesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : listSiteIds();
  const results = [];
  for (const siteId of sites) {
    try {
      const r = await runCoverageTick(siteId);
      results.push(r);
    } catch (e) {
      console.error(`coverage tick failed for ${siteId}:`, e);
      results.push({
        ok: false,
        siteId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return NextResponse.json({ ok: true, sites: results });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return tick(request);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return tick(request);
}
