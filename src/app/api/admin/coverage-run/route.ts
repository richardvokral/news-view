import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runCoverageTick } from "@/lib/monitor/coverage";
import { listSiteIds, isKnownSite } from "@/lib/plausible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const sitesParam = request.nextUrl.searchParams.get("site");
  const sites = sitesParam
    ? sitesParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && isKnownSite(s))
    : listSiteIds();
  const results = [];
  for (const siteId of sites) {
    try {
      const r = await runCoverageTick(siteId);
      results.push(r);
    } catch (e) {
      results.push({
        ok: false,
        siteId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return NextResponse.json({ ok: true, sites: results });
}
