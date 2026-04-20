import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { listLatestSourcesForArticle } from "@/lib/monitor/queries";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60;

interface PlausibleSourceRow {
  source: string;
  visitors: number;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const requestedSite = sp.get("site");
  const site = requestedSite && isKnownSite(requestedSite) ? requestedSite : null;
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const pagePath = sp.get("path");
  if (!pagePath || !pagePath.startsWith("/")) {
    return NextResponse.json(
      { error: "Missing or invalid path" },
      { status: 400 }
    );
  }

  const cfg = await getMonitorConfig();
  const hoursParam = sp.get("hours");
  const hours = hoursParam
    ? Math.min(Math.max(1, Number(hoursParam)), 168)
    : cfg.windowHours;

  if (cfg.sourceSamplingEnabled) {
    const sources = await listLatestSourcesForArticle(pagePath, hours);
    if (sources.length > 0) {
      return NextResponse.json({
        pagePath,
        source: "db",
        sources,
      });
    }
    // fall through to on-demand if DB has nothing yet
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `monitor:article-sources:${site}:${hours}:${pagePath}`;
  try {
    const redis = getRedis();
    const cached = await redis.get(key);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }
    const res = (await getBreakdown(site, {
      property: "visit:source",
      metrics: "visitors",
      period: "day",
      date: today,
      filters: `event:page==${pagePath}`,
      limit: 10,
    })) as { results?: PlausibleSourceRow[] };
    const sources = (res.results || [])
      .map((r) => ({
        source: String(r.source),
        visitors: Number(r.visitors) || 0,
      }))
      .sort((a, b) => b.visitors - a.visitors);
    const body = { pagePath, source: "plausible", sources };
    await redis.set(key, JSON.stringify(body), "EX", CACHE_TTL_SECONDS);
    return NextResponse.json(body);
  } catch (e) {
    console.error("article sources fetch failed:", e);
    return NextResponse.json(
      { pagePath, source: "error", sources: [] },
      { status: 200 }
    );
  }
}
