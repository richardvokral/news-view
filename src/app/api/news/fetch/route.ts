import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runFetchNews } from "@/lib/news-fetch";

export const maxDuration = 60;

/**
 * The `/news` "Fetch Now" button. It used to call `/api/cron/fetch-news`
 * with no credentials, which only worked because that endpoint failed open —
 * so triggering paid news-API fetches was open to the internet. Same work,
 * behind the `news` section grant.
 */
export async function POST() {
  const session = await getSession();
  if (!session.email || !session.sections.includes("news")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runFetchNews();
    if (result.status === "busy") {
      return NextResponse.json({ message: "Fetch already in progress" });
    }
    return NextResponse.json({
      success: true,
      fetched: result.fetched,
      stored: result.stored,
      duplicates: result.duplicates,
      pruned: result.pruned,
      timestamp: result.timestamp,
    });
  } catch (error) {
    console.error("News fetch error:", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
