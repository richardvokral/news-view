import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runFetchNews } from "@/lib/news-fetch";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Previously this accepted the mere *presence* of an `upstash-signature`
  // header (trivially forged) and was fully open when CRON_SECRET was unset.
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFetchNews();
    if (result.status === "busy") {
      return NextResponse.json(
        { message: "Fetch already in progress" },
        { status: 200 }
      );
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
    console.error("Cron fetch error:", error);
    return NextResponse.json(
      { error: "Fetch failed", details: String(error) },
      { status: 500 }
    );
  }
}
