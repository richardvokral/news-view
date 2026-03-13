import { NextRequest, NextResponse } from "next/server";
import { fetchAllNews } from "@/lib/fetchers";
import { storeArticles, pruneOldArticles, acquireFetchLock, releaseFetchLock } from "@/lib/storage/articles";
import { getApiConfig } from "@/lib/storage/settings";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel cron or QStash)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const qstashSignature = request.headers.get("upstash-signature");
    const bearerMatch = authHeader === `Bearer ${cronSecret}`;

    if (!bearerMatch && !qstashSignature) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Acquire lock to prevent overlapping runs
  const locked = await acquireFetchLock();
  if (!locked) {
    return NextResponse.json(
      { message: "Fetch already in progress" },
      { status: 200 }
    );
  }

  try {
    const config = await getApiConfig();
    const articles = await fetchAllNews(config);
    const stored = await storeArticles(articles);
    const pruned = await pruneOldArticles();

    console.log(
      `Fetch complete: ${articles.length} fetched, ${stored} stored, ${pruned} pruned`
    );

    return NextResponse.json({
      success: true,
      fetched: articles.length,
      stored,
      pruned,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cron fetch error:", error);
    return NextResponse.json(
      { error: "Fetch failed", details: String(error) },
      { status: 500 }
    );
  } finally {
    await releaseFetchLock();
  }
}
