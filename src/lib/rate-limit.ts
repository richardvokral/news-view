import type { NextRequest } from "next/server";
import { getRedis } from "./redis";

/**
 * Fixed-window counter in Redis. Deliberately fails *open* — Redis is the hot
 * path for the whole app, and a Redis outage taking down proofreading would be
 * a worse outcome than a brief window without throttling. Callers that need a
 * hard guarantee must not rely on this alone.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window expires; 0 when allowed. */
  retryAfter: number;
}

const ALLOWED: RateLimitResult = { allowed: true, retryAfter: 0 };

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    if (count > limit) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
    }
    return ALLOWED;
  } catch {
    return ALLOWED;
  }
}

/** Check several buckets at once; the first one to trip wins. */
export async function rateLimitAll(
  buckets: { key: string; limit: number; windowSeconds: number }[]
): Promise<RateLimitResult> {
  for (const b of buckets) {
    const result = await rateLimit(b.key, b.limit, b.windowSeconds);
    if (!result.allowed) return result;
  }
  return ALLOWED;
}

/**
 * Best-effort client IP. Behind Vercel the left-most `x-forwarded-for` entry is
 * the real client; it is still client-controlled, so treat per-IP limits as a
 * speed bump rather than an identity check.
 */
export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
