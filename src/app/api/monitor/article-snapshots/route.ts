import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb, hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the full visitor/pageview snapshot series for a single article,
 * honouring an optional since= ISO timestamp so the article-detail panel can
 * display the whole period from first-seen without being bounded by the
 * default 48-snapshot cap used for the list view.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const path = sp.get("path");
  if (!path || !path.startsWith("/")) {
    return NextResponse.json(
      { error: "Missing or invalid path" },
      { status: 400 }
    );
  }

  if (!hasDb()) {
    return NextResponse.json({ pagePath: path, snapshots: [] });
  }

  try {
    const sinceParam = sp.get("since");
    const hoursParam = sp.get("hours");
    const limitParam = sp.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(2, Number(limitParam)), 2000)
      : 500;

    let cutoff: Date | null = null;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!Number.isNaN(parsed.getTime())) cutoff = parsed;
    } else if (hoursParam) {
      const h = Math.min(Math.max(1, Number(hoursParam)), 24 * 31);
      cutoff = new Date(Date.now() - h * 3600 * 1000);
    }

    const params: unknown[] = [path];
    let where = "page_path = $1";
    if (cutoff) {
      params.push(cutoff);
      where += ` AND captured_at >= $${params.length}`;
    }
    params.push(limit);
    const { rows } = await getDb().query<{
      captured_at: string;
      window_seconds: number;
      visitors: number | null;
      pageviews: number | null;
    }>(
      `SELECT captured_at, window_seconds, visitors, pageviews
         FROM article_metric_snapshots
        WHERE ${where}
        ORDER BY captured_at ASC
        LIMIT $${params.length}`,
      params
    );

    return NextResponse.json({
      pagePath: path,
      snapshots: rows.map((r) => ({
        capturedAt: r.captured_at,
        windowSeconds: r.window_seconds,
        visitors: r.visitors,
        pageviews: r.pageviews,
      })),
    });
  } catch (e) {
    console.error("article-snapshots handler failed:", e);
    return NextResponse.json({ pagePath: path, snapshots: [] });
  }
}
