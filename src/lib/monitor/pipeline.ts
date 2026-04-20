import { getRedis } from "@/lib/redis";
import { listSiteIds, getBreakdown } from "@/lib/plausible";
import { getMonitorConfig } from "./config";
import {
  upsertArticle,
  insertSnapshot,
  insertArticleSourceSnapshot,
  pruneSnapshots,
  pruneArticleSourceSnapshots,
  pruneMonitors,
} from "./queries";

interface TickResult {
  ok: true;
  skippedReason?: string;
  sites: { siteId: string; articles: number; sources: number }[];
  pruned: { snapshots: number; monitors: number; sources: number };
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
      pruned: { snapshots: 0, monitors: 0, sources: 0 },
      requestsThisHour: 0,
    };
  }

  const sites = listSiteIds();
  if (sites.length === 0) {
    return {
      ok: true,
      skippedReason: "no_sites",
      sites: [],
      pruned: { snapshots: 0, monitors: 0, sources: 0 },
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
      pruned: { snapshots: 0, monitors: 0, sources: 0 },
      requestsThisHour: currentCount,
    };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const perSite: { siteId: string; articles: number; sources: number }[] = [];

  // Reserve rate budget for the source-sampling pass, if enabled. If it won't
  // fit, we run the article pass alone and log a note.
  const sourceBudget =
    cfg.sourceSamplingEnabled && cfg.sourceSamplingTopN > 0
      ? sites.length * cfg.sourceSamplingTopN
      : 0;
  const canSampleSources =
    sourceBudget > 0 &&
    currentCount + sites.length + sourceBudget <= cfg.maxRequestsPerHour;
  if (cfg.sourceSamplingEnabled && !canSampleSources) {
    console.warn(
      `monitor: source sampling skipped this tick (budget ${
        cfg.maxRequestsPerHour
      } would be exceeded by ${currentCount + sites.length + sourceBudget})`
    );
  }

  let callsMade = 0;
  for (const siteId of sites) {
    let sampledSources = 0;
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
      callsMade += 1;
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

      if (canSampleSources && rows.length > 0) {
        const top = [...rows]
          .sort((a, b) => (Number(b.visitors) || 0) - (Number(a.visitors) || 0))
          .slice(0, cfg.sourceSamplingTopN);
        for (const row of top) {
          try {
            const sr = (await getBreakdown(siteId, {
              property: "visit:source",
              metrics: "visitors",
              period: "day",
              date: today,
              filters: `event:page==${row.page}`,
              limit: 5,
            })) as {
              results?: { source: string; visitors: number }[];
            };
            callsMade += 1;
            for (const s of sr.results || []) {
              const src = String(s.source || "").trim();
              if (!src) continue;
              await insertArticleSourceSnapshot(
                row.page,
                now,
                src,
                Number(s.visitors) || 0
              );
              sampledSources += 1;
            }
          } catch (e) {
            console.error(
              `monitor source sample failed for ${siteId} ${row.page}:`,
              e
            );
            callsMade += 1; // be conservative
          }
        }
      }

      perSite.push({ siteId, articles: rows.length, sources: sampledSources });
    } catch (e) {
      console.error(`monitor tick failed for ${siteId}:`, e);
      callsMade += 1;
      perSite.push({ siteId, articles: 0, sources: 0 });
    }
  }
  if (callsMade > 0) {
    await redis.incrby(hourKey, callsMade);
    await redis.expire(hourKey, 3600);
  }

  const snapPruned = await pruneSnapshots(cfg.retentionDays);
  const srcPruned = await pruneArticleSourceSnapshots(cfg.retentionDays);
  const monPruned = await pruneMonitors(cfg.windowHours);

  return {
    ok: true,
    sites: perSite,
    pruned: { snapshots: snapPruned, monitors: monPruned, sources: srcPruned },
    requestsThisHour: currentCount + callsMade,
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
