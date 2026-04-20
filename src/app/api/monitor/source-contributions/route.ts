import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { getDb, hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlausiblePageRow {
  page: string;
  visitors: number;
  pageviews?: number;
}

/**
 * Per-page visitor contributions attributable to any of the given sources.
 * Unions live Plausible data (visit:source == A|B|C) with stored
 * article_source_snapshots for the window, preferring the max recorded
 * visitors per page to avoid double-counting.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const requestedSite = sp.get("site");
  const site =
    requestedSite && isKnownSite(requestedSite) ? requestedSite : null;
  if (!site) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const sourcesParam = sp.get("sources");
  if (!sourcesParam) {
    return NextResponse.json({
      contributions: {},
      meta: { sources: [], error: "no sources" },
    });
  }
  const sources = sourcesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sources.length === 0) {
    return NextResponse.json({
      contributions: {},
      meta: { sources: [], error: "empty sources" },
    });
  }

  try {
    const cfg = await getMonitorConfig();
    const hoursParam = sp.get("hours");
    const hours = hoursParam
      ? Math.min(Math.max(1, Number(hoursParam)), 168)
      : cfg.windowHours;
    const today = new Date().toISOString().slice(0, 10);

    const contribs: Record<string, { visitors: number; pageviews: number }> = {};
    const bump = (page: string, visitors: number, pageviews: number) => {
      if (!page) return;
      const cur = contribs[page];
      if (!cur) {
        contribs[page] = { visitors, pageviews };
      } else {
        cur.visitors = Math.max(cur.visitors, visitors);
        cur.pageviews = Math.max(cur.pageviews, pageviews);
      }
    };

    let plausibleError: string | null = null;
    try {
      const filter = `visit:source==${sources.join("|")}`;
      const res = (await getBreakdown(site, {
        property: "event:page",
        metrics: "visitors,pageviews",
        period: "day",
        date: today,
        filters: filter,
        limit: 200,
      })) as { results?: PlausiblePageRow[] };
      for (const r of res.results || []) {
        bump(
          String(r.page),
          Number(r.visitors) || 0,
          Number(r.pageviews) || 0
        );
      }
    } catch (e) {
      plausibleError = e instanceof Error ? e.message : String(e);
      console.error("source-contributions plausible failed:", e);
    }

    if (hasDb()) {
      try {
        const cutoff = new Date(Date.now() - hours * 3600 * 1000);
        const { rows } = await getDb().query<{
          page_path: string;
          visitors: number;
        }>(
          `SELECT s.page_path,
                  MAX(s.visitors) AS visitors
             FROM article_source_snapshots s
             JOIN article_monitors m ON m.page_path = s.page_path
            WHERE m.site_id = $1
              AND s.captured_at >= $2
              AND s.source = ANY($3::text[])
            GROUP BY s.page_path`,
          [site, cutoff, sources]
        );
        for (const r of rows) {
          bump(r.page_path, Number(r.visitors) || 0, 0);
        }
      } catch (e) {
        console.error("source-contributions DB failed:", e);
      }
    }

    return NextResponse.json({
      contributions: contribs,
      meta: {
        sources,
        pages: Object.keys(contribs).length,
        error: plausibleError,
      },
    });
  } catch (e) {
    console.error("source-contributions fatal:", e);
    return NextResponse.json({
      contributions: {},
      meta: {
        sources,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}
