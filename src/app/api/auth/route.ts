import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const FAIL_KEY_PREFIX = "auth:fail:";
const LOCK_KEY_PREFIX = "auth:lock:";
const FAIL_TTL_SECONDS = 15 * 60;
const LOCK_AFTER_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
// Constant minimum delay on every attempt to slow down credential stuffing
// even before the lockout threshold kicks in.
const MIN_DELAY_MS = 250;

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function readLock(ip: string): Promise<number | null> {
  try {
    const redis = getRedis();
    const ttl = await redis.ttl(`${LOCK_KEY_PREFIX}${ip}`);
    if (ttl > 0) return ttl;
    return null;
  } catch {
    return null;
  }
}

async function recordFailure(ip: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${FAIL_KEY_PREFIX}${ip}`;
    const fails = await redis.incr(key);
    if (fails === 1) {
      await redis.expire(key, FAIL_TTL_SECONDS);
    }
    if (fails >= LOCK_AFTER_FAILS) {
      await redis.set(`${LOCK_KEY_PREFIX}${ip}`, "1", "EX", LOCK_SECONDS);
    }
  } catch {
    // Best-effort: if Redis is down we still return 401 below, just without
    // throttling. Don't leak the failure to the caller.
  }
}

async function clearFailures(ip: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`${FAIL_KEY_PREFIX}${ip}`, `${LOCK_KEY_PREFIX}${ip}`);
  } catch {
    // ignore
  }
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const lockTtl = await readLock(ip);
  if (lockTtl !== null) {
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS));
    return NextResponse.json(
      {
        error: "Too many attempts. Try again later.",
        retryAfter: lockTtl,
      },
      { status: 429, headers: { "Retry-After": String(lockTtl) } }
    );
  }

  try {
    const { password } = (await request.json()) as { password?: unknown };
    const settingsPassword = process.env.SETTINGS_PASSWORD;

    if (!settingsPassword) {
      return NextResponse.json(
        { error: "Settings password not configured" },
        { status: 500 }
      );
    }

    // Constant minimum delay so the response time doesn't reveal whether the
    // password was the right length.
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS));

    if (typeof password === "string" && safeEqual(password, settingsPassword)) {
      await clearFailures(ip);
      const response = NextResponse.json({ success: true });
      response.cookies.set("settings_auth", "true", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 24, // 24 hours
      });
      return response;
    }

    await recordFailure(ip);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
