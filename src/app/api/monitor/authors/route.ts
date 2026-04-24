import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown, plausibleDayRange } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60;

interface PlausibleAuthorRow {
  name: string;
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
  if (pagePath && !pagePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const cfg = await getMonitorConfig();
    const hoursParam = sp.get("hours");
    const hours = hoursParam
      ? Math.min(Math.max(1, Number(hoursParam)), 168)
      : cfg.windowHours;

    const filters = pagePath
      ? `event:goal==author;event:page==${pagePath}`
      : `event:goal==author`;
    const key = `monitor:authors:${site}:${hours}:${pagePath ?? "all"}`;

    try {
      const redis = getRedis();
      const cached = await redis.get(key);
      if (cached) return NextResponse.json(JSON.parse(cached));
    } catch {
      // cache lookup is best-effort
    }

    const res = (await getBreakdown(site, {
      property: "event:props:name",
      metrics: "visitors",
      ...plausibleDayRange(hours),
      filters,
      limit: 50,
    })) as { results?: PlausibleAuthorRow[] };

    const authors = (res.results || [])
      .map((r) => ({
        name: String(r.name || "").trim(),
        visitors: Number(r.visitors) || 0,
      }))
      .filter((r) => r.name.length > 0 && r.name !== "(none)")
      .sort((a, b) => b.visitors - a.visitors);

    const body = { site, pagePath, authors };
    try {
      const redis = getRedis();
      await redis.set(key, JSON.stringify(body), "EX", CACHE_TTL_SECONDS);
    } catch {
      // cache write is best-effort
    }
    return NextResponse.json(body);
  } catch (e) {
    console.error("authors fetch failed:", e);
    return NextResponse.json({
      site,
      pagePath,
      authors: [],
      error: "fetch_failed",
    });
  }
}
