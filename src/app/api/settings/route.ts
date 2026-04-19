import { NextRequest, NextResponse } from "next/server";
import { getApiConfig, saveApiConfig } from "@/lib/storage/settings";
import { ApiConfig } from "@/lib/fetchers/types";
import { isAuthenticated } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getApiConfig();
    const masked: ApiConfig = {
      worldNewsApi: {
        enabled: config.worldNewsApi.enabled,
        apiKey: maskKey(config.worldNewsApi.apiKey),
      },
      newsDataHub: {
        enabled: config.newsDataHub.enabled,
        apiKey: maskKey(config.newsDataHub.apiKey),
      },
      gnews: {
        enabled: config.gnews.enabled,
        apiKey: maskKey(config.gnews.apiKey),
      },
      twitter: {
        enabled: config.twitter.enabled,
        bearerToken: maskKey(config.twitter.bearerToken),
      },
      rssFeeds: config.rssFeeds,
      clustering: {
        mode: config.clustering.mode,
        anthropicApiKey: maskKey(config.clustering.anthropicApiKey),
        openaiApiKey: maskKey(config.clustering.openaiApiKey),
      },
      excludeWords: config.excludeWords || [],
    };
    return NextResponse.json(masked);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load settings", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const currentConfig = await getApiConfig();

    const newConfig: ApiConfig = {
      worldNewsApi: {
        enabled: body.worldNewsApi?.enabled ?? currentConfig.worldNewsApi.enabled,
        apiKey: isMasked(body.worldNewsApi?.apiKey)
          ? currentConfig.worldNewsApi.apiKey
          : body.worldNewsApi?.apiKey ?? currentConfig.worldNewsApi.apiKey,
      },
      newsDataHub: {
        enabled: body.newsDataHub?.enabled ?? currentConfig.newsDataHub.enabled,
        apiKey: isMasked(body.newsDataHub?.apiKey)
          ? currentConfig.newsDataHub.apiKey
          : body.newsDataHub?.apiKey ?? currentConfig.newsDataHub.apiKey,
      },
      gnews: {
        enabled: body.gnews?.enabled ?? currentConfig.gnews.enabled,
        apiKey: isMasked(body.gnews?.apiKey)
          ? currentConfig.gnews.apiKey
          : body.gnews?.apiKey ?? currentConfig.gnews.apiKey,
      },
      twitter: {
        enabled: body.twitter?.enabled ?? currentConfig.twitter.enabled,
        bearerToken: isMasked(body.twitter?.bearerToken)
          ? currentConfig.twitter.bearerToken
          : body.twitter?.bearerToken ?? currentConfig.twitter.bearerToken,
      },
      rssFeeds: {
        guardian: body.rssFeeds?.guardian ?? currentConfig.rssFeeds.guardian,
        spiegel: body.rssFeeds?.spiegel ?? currentConfig.rssFeeds.spiegel,
        dw: body.rssFeeds?.dw ?? currentConfig.rssFeeds.dw,
        foxNews: body.rssFeeds?.foxNews ?? currentConfig.rssFeeds.foxNews,
        reuters: body.rssFeeds?.reuters ?? currentConfig.rssFeeds.reuters,
      },
      clustering: {
        mode: body.clustering?.mode ?? currentConfig.clustering.mode,
        anthropicApiKey: isMasked(body.clustering?.anthropicApiKey)
          ? currentConfig.clustering.anthropicApiKey
          : body.clustering?.anthropicApiKey ?? currentConfig.clustering.anthropicApiKey,
        openaiApiKey: isMasked(body.clustering?.openaiApiKey)
          ? currentConfig.clustering.openaiApiKey
          : body.clustering?.openaiApiKey ?? currentConfig.clustering.openaiApiKey,
      },
      excludeWords: Array.isArray(body.excludeWords)
        ? body.excludeWords.filter((w: unknown) => typeof w === "string" && w.trim())
        : currentConfig.excludeWords || [],
    };

    await saveApiConfig(newConfig);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save settings", details: String(error) },
      { status: 500 }
    );
  }
}

function maskKey(key: string): string {
  if (!key || key.length <= 4) return key ? "****" : "";
  return "****" + key.slice(-4);
}

function isMasked(value: string | undefined): boolean {
  return !value || value.startsWith("****");
}
