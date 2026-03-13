import { NextRequest, NextResponse } from "next/server";
import { getArticles, getLastFetchTime } from "@/lib/storage/articles";
import { getApiConfig } from "@/lib/storage/settings";
import { getClusteringStrategy } from "@/lib/clustering";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const excludeCategories = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];
    const days = parseInt(searchParams.get("days") ?? "3", 10);

    const config = await getApiConfig();
    const articles = await getArticles(days);
    const lastFetch = await getLastFetchTime();

    const strategy = getClusteringStrategy(config);
    let topics = await strategy.cluster(articles);

    // Apply category filter
    if (excludeCategories.length > 0) {
      topics = topics.filter(
        (t) => !t.category || !excludeCategories.includes(t.category.toLowerCase())
      );
    }

    return NextResponse.json({
      topics,
      totalArticles: articles.length,
      lastFetch,
      clusteringMode: config.clustering.mode,
    });
  } catch (error) {
    console.error("Topics API error:", error);
    return NextResponse.json(
      { error: "Failed to load topics", details: String(error) },
      { status: 500 }
    );
  }
}
