import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { listArticles, listKnownSections } from "@/lib/insights/store";
import { toDateString, weekStartOf, addDays } from "@/lib/insights/weeks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const site = sp.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const now = new Date();
  const defaultTo = toDateString(weekStartOf(now));
  const defaultFrom = toDateString(addDays(weekStartOf(now), -7 * 12));

  const from = sp.get("from") || defaultFrom;
  const to = sp.get("to") || defaultTo;
  const sections = (sp.get("sections") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const rankBy = sp.get("rankBy") === "visitors" ? "visitorsSum" : "pageviews";
  const includePartialWeeks = sp.get("partial") === "1";
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), 1000)
    : 200;

  try {
    const [articles, knownSections] = await Promise.all([
      listArticles({
        siteId: site,
        weekStartFrom: from,
        weekStartTo: to,
        sections,
        includePartialWeeks,
        rankBy,
        limit,
      }),
      listKnownSections(site),
    ]);
    return NextResponse.json({
      site,
      from,
      to,
      rankBy,
      includePartialWeeks,
      articles,
      knownSections,
    });
  } catch (error) {
    console.error("insights articles failed:", error);
    return NextResponse.json(
      { error: "Failed to load articles" },
      { status: 500 }
    );
  }
}
