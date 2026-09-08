import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared gate for `/api/cron/*`. These routes are a middleware exception (no
 * Logto cookie), so the secret is the only thing standing between the public
 * internet and paid work: news-API quota, Plausible calls, LLM spend.
 *
 * Fails closed. If `CRON_SECRET` is unset the endpoint is unusable rather than
 * open — an unset secret used to mean "no auth at all" on `fetch-news`.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && constantTimeEquals(match[1].trim(), secret)) return true;
  }

  // Query-string fallback for schedulers that can't set headers. It leaks the
  // secret into access logs, so prefer the Authorization header.
  const qs = request.nextUrl.searchParams.get("secret");
  if (qs && constantTimeEquals(qs, secret)) return true;

  return false;
}
