import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.STORAGE_REDIS_REDIS_URL;

    if (!url) {
      throw new Error("Missing STORAGE_REDIS_REDIS_URL environment variable");
    }

    redis = new Redis(url);
  }
  return redis;
}
