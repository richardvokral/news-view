import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { getInsightsConfig, listSlugsForVocabulary } from "@/lib/insights/store";
import { countLeadingTokens } from "@/lib/insights/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Empirical section discovery. Rather than guessing a taxonomy up front, count
 * how often each token appears in leading slug position and let an admin
 * promote the real ones into the vocabulary.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const site = request.nextUrl.searchParams.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }

  const [config, slugs] = await Promise.all([
    getInsightsConfig(),
    listSlugsForVocabulary(site),
  ]);
  const known = new Set(config.sectionVocabulary);

  const suggestions = countLeadingTokens(slugs)
    .filter((t) => t.share >= 0.005 && t.token.length >= 3)
    .slice(0, 40)
    .map((t) => ({ ...t, known: known.has(t.token) }));

  return NextResponse.json({
    site,
    sampled: slugs.length,
    vocabulary: config.sectionVocabulary,
    suggestions,
  });
}
