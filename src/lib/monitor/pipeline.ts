import { getRedis } from "@/lib/redis";
import { listSiteIds, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "./config";
import {
  upsertArticle,
  insertSnapshot,
  pruneSnapshots,
  pruneMonitors,
} from "./queries";

interface TickResult {
  ok: true;
  skippedReason?: string;
  sites: { siteId: string; articles: number }[];
  pruned: { snapshots: number; monitors: number };
  requestsThisHour: number;
}

/**
 * One pass over every configured site: pull today's per-page visitor/pageview
 * totals from Plausible, upsert matching article pages, snapshot their counts.
 * Rate-capped via a Redis hourly counter. Idempotent.
 */
export async function runMonitorTick(): Promise<TickResult> {
  const cfg = await getMonitorConfig();
  if (!cfg.enabled) {
    return {
      ok: true,
      skippedReason: "disabled",
      sites: [],
      pruned: { snapshots: 0, monitors: 0 },
      requestsThisHour: 0,
    };
  }

  const sites = listSiteIds();
  if (sites.length === 0) {
    return {
      ok: true,
      skippedReason: "no_sites",
      sites: [],
      pruned: { snapshots: 0, monitors: 0 },
      requestsThisHour: 0,
    };
  }

  const redis = getRedis();
  const hourKey = `monitor:requests:${new Date().toISOString().slice(0, 13)}`;
  const currentCount = Number((await redis.get(hourKey)) || 0);
  if (currentCount + sites.length > cfg.maxRequestsPerHour) {
    return {
      ok: true,
      skippedReason: "rate_capped",
      sites: [],
      pruned: { snapshots: 0, monitors: 0 },
      requestsThisHour: currentCount,
    };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const perSite: { siteId: string; articles: number }[] = [];

  for (const siteId of sites) {
    try {
      const raw = (await getBreakdown(siteId, {
        property: "event:page",
        metrics: "visitors,pageviews",
        period: "day",
        date: today,
        limit: 100,
      })) as {
        results?: { page: string; visitors: number; pageviews: number }[];
      };
      const regex = buildSiteRegex(cfg.sitePatterns[siteId]);
      const rows = (raw.results || []).filter((r) =>
        regex.test(String(r.page))
      );
      for (const row of rows) {
        await upsertArticle(row.page, siteId, now);
        await insertSnapshot(
          row.page,
          now,
          cfg.intervalSeconds,
          Number(row.visitors) || 0,
          Number(row.pageviews) || 0
        );
      }
      perSite.push({ siteId, articles: rows.length });
    } catch (e) {
      console.error(`monitor tick failed for ${siteId}:`, e);
      perSite.push({ siteId, articles: 0 });
    }
    // Count the call regardless of success (be conservative against quotas).
    await redis.incr(hourKey);
  }
  await redis.expire(hourKey, 3600);

  const snapPruned = await pruneSnapshots(cfg.retentionDays);
  const monPruned = await pruneMonitors(cfg.windowHours);

  return {
    ok: true,
    sites: perSite,
    pruned: { snapshots: snapPruned, monitors: monPruned },
    requestsThisHour: currentCount + sites.length,
  };
}

function buildSiteRegex(pattern: string | undefined): RegExp {
  if (!pattern || !pattern.trim()) return /^\/[^?#]+$/;
  try {
    return new RegExp(pattern);
  } catch {
    return /^\/[^?#]+$/;
  }
}
