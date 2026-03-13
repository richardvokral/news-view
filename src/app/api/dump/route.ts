import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getApiConfig } from "@/lib/storage/settings";

export const dynamic = "force-dynamic";

function isAuthenticated(request: NextRequest): boolean {
  return request.cookies.get("settings_auth")?.value === "true";
}

function maskKey(key: string): string {
  if (!key || key.length <= 4) return key ? "****" : "";
  return "****" + key.slice(-4);
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const redis = getRedis();

    // Get all articles
    const articleStrings = await redis.zrangebyscore("articles:all", 0, "+inf");
    const articles = articleStrings.map((s: string) => {
      try { return JSON.parse(s); } catch { return s; }
    });

    // Get config (masked)
    const config = await getApiConfig();
    const maskedConfig = {
      worldNewsApi: { enabled: config.worldNewsApi.enabled, apiKey: maskKey(config.worldNewsApi.apiKey) },
      newsDataHub: { enabled: config.newsDataHub.enabled, apiKey: maskKey(config.newsDataHub.apiKey) },
      gnews: { enabled: config.gnews.enabled, apiKey: maskKey(config.gnews.apiKey) },
      twitter: { enabled: config.twitter.enabled, bearerToken: maskKey(config.twitter.bearerToken) },
      clustering: { mode: config.clustering.mode, anthropicApiKey: maskKey(config.clustering.anthropicApiKey) },
      excludeWords: config.excludeWords,
    };

    // Get last fetch time
    const lastFetch = await redis.get("fetch:last");

    // Get gnews rate limit counters
    const today = new Date().toISOString().split("T")[0];
    const gnewsCount = await redis.get(`gnews:requests:${today}`);

    const dump = {
      exportedAt: new Date().toISOString(),
      config: maskedConfig,
      lastFetch,
      gnewsRequestsToday: gnewsCount ? parseInt(gnewsCount, 10) : 0,
      totalArticles: articles.length,
      articles,
    };

    return NextResponse.json(dump);
  } catch (error) {
    return NextResponse.json(
      { error: "Dump failed", details: String(error) },
      { status: 500 }
    );
  }
}
