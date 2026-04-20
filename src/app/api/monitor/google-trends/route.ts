import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMonitorConfig } from "@/lib/monitor/config";
import {
  fetchGoogleTrends,
  getLatestSnapshot,
  persistSnapshot,
  type TrendsSnapshot,
} from "@/lib/monitor/google-trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadAll(locales: string[]): Promise<{
  snapshots: TrendsSnapshot[];
}> {
  const snapshots = await Promise.all(
    locales.map(async (locale) => {
      const cached = await getLatestSnapshot(locale);
      return (
        cached ?? {
          locale,
          fetchedAt: "",
          source: "scrape.do",
          data: [],
          error: "no_snapshot_yet",
        }
      );
    })
  );
  return { snapshots };
}

async function refreshAll(locales: string[]): Promise<{
  snapshots: TrendsSnapshot[];
}> {
  const snapshots: TrendsSnapshot[] = [];
  for (const locale of locales) {
    const snap = await fetchGoogleTrends(locale);
    if (!snap.error || snap.data.length > 0) {
      try {
        await persistSnapshot(snap);
      } catch (e) {
        console.error("google-trends persist failed:", e);
      }
    }
    snapshots.push(snap);
  }
  return { snapshots };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const cfg = await getMonitorConfig();
    if (!cfg.googleTrendsEnabled) {
      return NextResponse.json({
        enabled: false,
        locales: [],
        snapshots: [],
      });
    }
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const localeParam = request.nextUrl.searchParams.get("locale");
    const locales = (
      localeParam
        ? [localeParam]
        : cfg.googleTrendsLocales
    )
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 3);
    if (locales.length === 0) {
      return NextResponse.json({
        enabled: true,
        locales,
        snapshots: [],
        error: "No locales configured",
      });
    }
    const { snapshots } = refresh
      ? await refreshAll(locales)
      : await loadAll(locales);
    return NextResponse.json({
      enabled: true,
      locales,
      snapshots,
      refreshed: refresh,
    });
  } catch (e) {
    console.error("google-trends handler failed:", e);
    return NextResponse.json({
      enabled: false,
      locales: [],
      snapshots: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(request: NextRequest) {
  // Same auth as GET; POST always refreshes.
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const cfg = await getMonitorConfig();
    if (!cfg.googleTrendsEnabled) {
      return NextResponse.json({ enabled: false, snapshots: [] });
    }
    const localeParam = request.nextUrl.searchParams.get("locale");
    const locales = (
      localeParam ? [localeParam] : cfg.googleTrendsLocales
    )
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 3);
    const { snapshots } = await refreshAll(locales);
    return NextResponse.json({
      enabled: true,
      locales,
      snapshots,
      refreshed: true,
    });
  } catch (e) {
    console.error("google-trends refresh handler failed:", e);
    return NextResponse.json({
      enabled: false,
      snapshots: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
