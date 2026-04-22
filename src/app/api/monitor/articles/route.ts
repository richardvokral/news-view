import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listArticlesWithRecentStats } from "@/lib/monitor/queries";
import { getMonitorConfig } from "@/lib/monitor/config";
import { isKnownSite } from "@/lib/plausible";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 30;

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
  const pagesParam = request.nextUrl.searchParams.get("pages");
  const pagePaths = pagesParam
    ? pagesParam
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : undefined;

  const cacheKey = `monitor:articles:${siteId ?? "all"}:${hours}:${snapshotLimit}:${
    pagePaths ? pagePaths.slice().sort().join(",") : "all"
  }`;
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json(JSON.parse(cached));
  } catch {
    // cache lookup is best-effort
  }

  const articles = await listArticlesWithRecentStats(
    siteId,
    hours,
    snapshotLimit,
    pagePaths
  );
  const body = {
    articles,
    windowHours: hours,
    siteId,
  };
  try {
    const redis = getRedis();
    await redis.set(cacheKey, JSON.stringify(body), "EX", CACHE_TTL_SECONDS);
  } catch {
    // cache write is best-effort
  }
  return NextResponse.json(body);
}
