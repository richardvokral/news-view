import { getRedis } from "../redis";
import { ApiConfig, DEFAULT_API_CONFIG } from "../fetchers/types";

const CONFIG_KEY = "config:apis";

export async function getApiConfig(): Promise<ApiConfig> {
  const redis = getRedis();
  const raw = await redis.get(CONFIG_KEY);

  if (!raw) {
    return applyEnvDefaults(DEFAULT_API_CONFIG);
  }

  const config = JSON.parse(raw);
  if (!Array.isArray(config.excludeWords)) {
    config.excludeWords = [];
  }
  if (!config.clustering.openaiApiKey) {
    config.clustering.openaiApiKey = "";
  }
  if (!config.rssFeeds) {
    config.rssFeeds = DEFAULT_API_CONFIG.rssFeeds;
  }
  return applyEnvDefaults(config as ApiConfig);
}

export async function saveApiConfig(config: ApiConfig): Promise<void> {
  const redis = getRedis();
  await redis.set(CONFIG_KEY, JSON.stringify(config));
}

function applyEnvDefaults(config: ApiConfig): ApiConfig {
  return {
    worldNewsApi: {
      enabled: config.worldNewsApi.enabled,
      apiKey: config.worldNewsApi.apiKey || process.env.WORLDNEWSAPI_KEY || "",
    },
    newsDataHub: {
      enabled: config.newsDataHub.enabled,
      apiKey: config.newsDataHub.apiKey || process.env.NEWSDATAHUB_KEY || "",
    },
    gnews: {
      enabled: config.gnews.enabled,
      apiKey: config.gnews.apiKey || process.env.GNEWS_KEY || "",
    },
    twitter: {
      enabled: config.twitter.enabled,
      bearerToken:
        config.twitter.bearerToken || process.env.TWITTER_BEARER_TOKEN || "",
    },
    clustering: {
      mode: config.clustering.mode,
      anthropicApiKey:
        config.clustering.anthropicApiKey ||
        process.env.ANTHROPIC_API_KEY ||
        "",
      openaiApiKey:
        config.clustering.openaiApiKey ||
        process.env.OPENAI_API_KEY ||
        "",
    },
    rssFeeds: config.rssFeeds || DEFAULT_API_CONFIG.rssFeeds,
    excludeWords: config.excludeWords || [],
  };
}
