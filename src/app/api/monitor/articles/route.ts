import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listArticlesWithRecentStats } from "@/lib/monitor/queries";
import { getMonitorConfig } from "@/lib/monitor/config";
import { isKnownSite } from "@/lib/plausible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedSite = request.nextUrl.searchParams.get("site");
  const siteId = requestedSite && isKnownSite(requestedSite) ? requestedSite : null;
  const hoursParam = request.nextUrl.searchParams.get("hours");
  const defaultWindow = (await getMonitorConfig()).windowHours;
  const hours = hoursParam ? Math.min(Math.max(1, Number(hoursParam)), 168) : defaultWindow;
  const snapshotsParam = request.nextUrl.searchParams.get("snapshots");
  const snapshotLimit = snapshotsParam ? Math.min(Math.max(2, Number(snapshotsParam)), 200) : 48;

  const articles = await listArticlesWithRecentStats(siteId, hours, snapshotLimit);
  return NextResponse.json({
    articles,
    windowHours: hours,
    siteId,
  });
}
