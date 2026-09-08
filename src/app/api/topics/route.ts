import { NextRequest, NextResponse } from "next/server";
import { getArticles, getLastFetchTime } from "@/lib/storage/articles";
import { getApiConfig } from "@/lib/storage/settings";
import { getClusteringStrategy } from "@/lib/clustering";
import { getRedis } from "@/lib/redis";
import { getSession } from "@/lib/auth";
import { Topic } from "@/lib/fetchers/types";

export const dynamic = "force-dynamic";

const TOPICS_CACHE_KEY = "cache:topics";
const TOPICS_CACHE_META_KEY = "cache:topics:meta";

interface CachedTopics {
  topics: Topic[];
  totalArticles: number;
  lastFetch: string | null;
  clusteringMode: string;
  cachedAt: string;
}

export async function GET(request: NextRequest) {
  // This route was unauthenticated, and `?refresh=1` re-runs clustering —
  // which in `ai`/`hybrid` mode is a paid LLM call anyone could trigger.
  const session = await getSession();
  if (!session.email || !session.sections.includes("news")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const excludeCategories = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];
    const rawDays = parseInt(searchParams.get("days") ?? "3", 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 30) : 3;
    // Forcing a re-cluster costs money; the cached path stays open to any
    // news user, the refresh path is admin-only.
    const forceRefresh = searchParams.get("refresh") === "1" && session.isAdmin;

    const config = await getApiConfig();
    const lastFetch = await getLastFetchTime();

    if (!forceRefresh) {
      const cached = await getCachedTopics();
      if (cached && cached.lastFetch === lastFetch && cached.clusteringMode === config.clustering.mode) {
        let topics = cached.topics;
        if (excludeCategories.length > 0) {
          topics = topics.filter(
            (t) => !t.category || !excludeCategories.includes(t.category.toLowerCase())
          );
        }
        return NextResponse.json({
          topics,
          totalArticles: cached.totalArticles,
          lastFetch: cached.lastFetch,
          clusteringMode: cached.clusteringMode,
          cached: true,
        });
      }
    }

    const articles = await getArticles(days);

    const strategy = getClusteringStrategy(config);
    let topics = await strategy.cluster(articles);

    await cacheTopics({
      topics,
      totalArticles: articles.length,
      lastFetch,
      clusteringMode: config.clustering.mode,
      cachedAt: new Date().toISOString(),
    });

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
      cached: false,
    });
  } catch (error) {
    console.error("Topics API error:", error);
    return NextResponse.json(
      { error: "Failed to load topics", details: String(error) },
      { status: 500 }
    );
  }
}

async function getCachedTopics(): Promise<CachedTopics | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(TOPICS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function cacheTopics(data: CachedTopics): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(TOPICS_CACHE_KEY, JSON.stringify(data), "EX", 3600);
  } catch {
    // Cache write failure is non-critical
  }
}

