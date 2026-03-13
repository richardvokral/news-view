import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL;

    if (!url) {
      throw new Error("Missing REDIS_URL environment variable");
    }

    redis = new Redis(url);
  }
  return redis;
}
