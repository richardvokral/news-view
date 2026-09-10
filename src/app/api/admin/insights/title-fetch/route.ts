import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import {
  cancelTitleFetch,
  getTitleCoverage,
  runTitleFetch,
} from "@/lib/insights/titleFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep in sync with TITLE_FETCH_MAX_DURATION_S; Next needs a literal here.
export const maxDuration = 300;

/** Admin-only: this one spends requests against the newsroom's own origin. */
async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return { denied: NextResponse.json({ error: "Admin required" }, { status: 403 }) };
  }
  return { email: session.email };
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const site = request.nextUrl.searchParams.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  return NextResponse.json({ site, coverage: await getTitleCoverage(site) });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const site = typeof body.site === "string" ? body.site : "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  if (body.cancel === true && typeof body.runKey === "string") {
    await cancelTitleFetch(body.runKey.slice(0, 64));
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await runTitleFetch(site, {
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? Math.min(Math.max(1, Math.round(body.limit)), 1000)
          : undefined,
      runKey: typeof body.runKey === "string" ? body.runKey.slice(0, 64) : undefined,
    });
    return NextResponse.json({
      ...result,
      coverage: await getTitleCoverage(site),
    });
  } catch (error) {
    console.error("title fetch failed:", error);
    return NextResponse.json({ error: "Title fetch failed" }, { status: 500 });
  }
}
