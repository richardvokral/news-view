import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { getMonitorConfig } from "@/lib/monitor/config";
import { listCoverageForSite } from "@/lib/monitor/coverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const cfg = await getMonitorConfig();
    const hoursParam = sp.get("hours");
    const hours = hoursParam
      ? Math.min(Math.max(1, Number(hoursParam)), 168)
      : cfg.coverageWindowHours;

    const { externals, analysisByExternalId, ourTitles } =
      await listCoverageForSite(site, hours);

    const uncovered: Array<{
      externalId: number;
      feedSource: string;
      title: string;
      link: string;
      pubDate: string | null;
      importance: number;
      rationale: string | null;
      analyzedAt: string;
    }> = [];
    const coveredBuckets: Map<
      string,
      {
        ourPath: string;
        ourTitle: string;
        matches: Array<{
          externalId: number;
          feedSource: string;
          title: string;
          link: string;
          pubDate: string | null;
          importance: number;
        }>;
      }
    > = new Map();

    for (const ext of externals) {
      const a = analysisByExternalId.get(ext.id);
      if (!a) continue;
      if (!a.covered) {
        uncovered.push({
          externalId: ext.id,
          feedSource: ext.feedSource,
          title: ext.title,
          link: ext.link,
          pubDate: ext.pubDate,
          importance: a.importance,
          rationale: a.rationale,
          analyzedAt: a.analyzedAt,
        });
      } else {
        const primary = a.matchedOurPaths[0];
        if (!primary) continue;
        const ourTitle = ourTitles.get(primary) ?? primary;
        const bucket =
          coveredBuckets.get(primary) ??
          {
            ourPath: primary,
            ourTitle,
            matches: [],
          };
        bucket.matches.push({
          externalId: ext.id,
          feedSource: ext.feedSource,
          title: ext.title,
          link: ext.link,
          pubDate: ext.pubDate,
          importance: a.importance,
        });
        coveredBuckets.set(primary, bucket);
      }
    }

    uncovered.sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      const at = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bt = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bt - at;
    });

    const covered = Array.from(coveredBuckets.values()).map((b) => ({
      ourPath: b.ourPath,
      ourTitle: b.ourTitle,
      matches: b.matches.slice(0, 3),
      matchCount: b.matches.length,
      maxImportance: b.matches.reduce(
        (m, x) => Math.max(m, x.importance),
        0
      ),
    }));
    covered.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.maxImportance - a.maxImportance;
    });

    return NextResponse.json({
      site,
      windowHours: hours,
      totalExternals: externals.length,
      analysed: analysisByExternalId.size,
      uncovered,
      covered,
      enabled: cfg.coverageEnabled,
      externalRssEnabled: cfg.externalRssEnabled,
      feeds: cfg.externalRssUrls,
    });
  } catch (e) {
    console.error("coverage list handler failed:", e);
    return NextResponse.json({
      site,
      windowHours: 0,
      totalExternals: 0,
      analysed: 0,
      uncovered: [],
      covered: [],
      enabled: false,
      externalRssEnabled: false,
      feeds: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
