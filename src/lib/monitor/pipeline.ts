import { getRedis } from "@/lib/redis";
import { listSiteIds, getBreakdown, plausibleDayRange } from "@/lib/plausible";
import { getMonitorConfig } from "./config";
import { fetchRssFeed, type RssItem } from "./rss";
import {
  upsertArticle,
  insertSnapshot,
  insertArticleSourceSnapshot,
  insertArticleAuthorSnapshot,
  insertArticleTitle,
  getLatestTitle,
  pruneSnapshots,
  pruneArticleSourceSnapshots,
  pruneArticleAuthorSnapshots,
  pruneMonitors,
} from "./queries";

interface TickResult {
  ok: true;
  skippedReason?: string;
  sites: {
    siteId: string;
    articles: number;
    sources: number;
    authors?: number;
    titles?: number;
  }[];
  pruned: {
    snapshots: number;
    monitors: number;
    sources: number;
    authors?: number;
  };
  requestsThisHour: number;
}

/**
 * One pass over every configured site: pull per-page visitor/pageview totals
 * from Plausible over a rolling 48h (yesterday..today UTC) window — this
 * avoids the counts snapping down to near-zero at UTC midnight — then upsert
 * matching article pages and snapshot their counts.
 * Rate-capped via a Redis hourly counter. Idempotent.
 */
export async function runMonitorTick(): Promise<TickResult> {
  const cfg = await getMonitorConfig();
  if (!cfg.enabled) {
    return {
      ok: true,
      skippedReason: "disabled",
      sites: [],
      pruned: { snapshots: 0, monitors: 0, sources: 0, authors: 0 },
      requestsThisHour: 0,
    };
  }

  const sites = listSiteIds();
  if (sites.length === 0) {
    return {
      ok: true,
      skippedReason: "no_sites",
      sites: [],
      pruned: { snapshots: 0, monitors: 0, sources: 0, authors: 0 },
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
      pruned: { snapshots: 0, monitors: 0, sources: 0, authors: 0 },
      requestsThisHour: currentCount,
    };
  }

  const now = new Date();
  const dayRange = plausibleDayRange(cfg.windowHours, now);
  const perSite: {
    siteId: string;
    articles: number;
    sources: number;
    authors?: number;
    titles?: number;
  }[] = [];

  // Fetch RSS feeds up front (in parallel). Reuses one HTTP call per site per
  // tick; doesn't consume the Plausible hourly budget.
  const rssBySite = new Map<string, Map<string, RssItem>>();
  if (cfg.rssEnabled) {
    await Promise.all(
      sites.map(async (siteId) => {
        const url = cfg.siteRssUrls[siteId];
        if (!url) return;
        const feed = await fetchRssFeed(url);
        const byPath = new Map<string, RssItem>();
        for (const item of feed.items) {
          if (!byPath.has(item.pagePath)) byPath.set(item.pagePath, item);
        }
        rssBySite.set(siteId, byPath);
      })
    );
  }

  // Reserve rate budget for the source-sampling pass, if enabled. If it won't
  // fit, we run the article pass alone and log a note.
  const sourceBudget =
    cfg.sourceSamplingEnabled && cfg.sourceSamplingTopN > 0
      ? sites.length * cfg.sourceSamplingTopN
      : 0;
  const authorBudget =
    cfg.authorSamplingEnabled && cfg.sourceSamplingTopN > 0
      ? sites.length * cfg.sourceSamplingTopN
      : 0;
  const canSampleSources =
    sourceBudget > 0 &&
    currentCount + sites.length + sourceBudget + authorBudget <=
      cfg.maxRequestsPerHour;
  if (cfg.sourceSamplingEnabled && !canSampleSources) {
    console.warn(
      `monitor: source sampling skipped this tick (budget ${
        cfg.maxRequestsPerHour
      } would be exceeded by ${
        currentCount + sites.length + sourceBudget + authorBudget
      })`
    );
  }
  const canSampleAuthors =
    authorBudget > 0 &&
    currentCount + sites.length + sourceBudget + authorBudget <=
      cfg.maxRequestsPerHour;
  if (cfg.authorSamplingEnabled && !canSampleAuthors) {
    console.warn(
      `monitor: author sampling skipped this tick (budget ${cfg.maxRequestsPerHour} would be exceeded)`
    );
  }

  let callsMade = 0;
  for (const siteId of sites) {
    let sampledSources = 0;
    let sampledAuthors = 0;
    try {
      const raw = (await getBreakdown(siteId, {
        property: "event:page",
        metrics: "visitors,pageviews",
        ...dayRange,
        limit: 100,
      })) as {
        results?: { page: string; visitors: number; pageviews: number }[];
      };
      callsMade += 1;
      const regex = buildSiteRegex(cfg.sitePatterns[siteId]);
      const rows = (raw.results || []).filter((r) =>
        regex.test(String(r.page))
      );
      let titlesWritten = 0;
      const rssByPath = rssBySite.get(siteId);
      for (const row of rows) {
        await upsertArticle(row.page, siteId, now);
        await insertSnapshot(
          row.page,
          now,
          cfg.intervalSeconds,
          Number(row.visitors) || 0,
          Number(row.pageviews) || 0
        );

        if (rssByPath) {
          const rssItem = rssByPath.get(row.page);
          if (rssItem) {
            const latest = await getLatestTitle(row.page);
            const titleChanged = !latest || latest.title !== rssItem.title;
            const imageChanged =
              !latest || (latest.imageUrl ?? null) !== (rssItem.imageUrl ?? null);
            if (titleChanged || imageChanged) {
              const parsedPubDate = rssItem.pubDate
                ? new Date(rssItem.pubDate)
                : null;
              await insertArticleTitle(
                row.page,
                siteId,
                now,
                rssItem.title,
                rssItem.imageUrl,
                parsedPubDate && !Number.isNaN(parsedPubDate.getTime())
                  ? parsedPubDate
                  : null
              );
              titlesWritten += 1;
            }
          }
        }
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
              ...dayRange,
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

      if (canSampleAuthors && rows.length > 0) {
        const top = [...rows]
          .sort(
            (a, b) => (Number(b.visitors) || 0) - (Number(a.visitors) || 0)
          )
          .slice(0, cfg.sourceSamplingTopN);
        for (const row of top) {
          try {
            const ar = (await getBreakdown(siteId, {
              property: "event:props:name",
              metrics: "visitors",
              ...dayRange,
              filters: `event:goal==author;event:page==${row.page}`,
              limit: 5,
            })) as { results?: { name: string; visitors: number }[] };
            callsMade += 1;
            for (const a of ar.results || []) {
              const name = String(a.name || "").trim();
              if (!name || name === "(none)") continue;
              await insertArticleAuthorSnapshot(
                row.page,
                now,
                name,
                Number(a.visitors) || 0
              );
              sampledAuthors += 1;
            }
          } catch (e) {
            console.error(
              `monitor author sample failed for ${siteId} ${row.page}:`,
              e
            );
            callsMade += 1;
          }
        }
      }

      perSite.push({
        siteId,
        articles: rows.length,
        sources: sampledSources,
        authors: sampledAuthors,
        titles: titlesWritten,
      });
    } catch (e) {
      console.error(`monitor tick failed for ${siteId}:`, e);
      callsMade += 1;
      perSite.push({
        siteId,
        articles: 0,
        sources: 0,
        authors: 0,
        titles: 0,
      });
    }
  }
  if (callsMade > 0) {
    await redis.incrby(hourKey, callsMade);
    await redis.expire(hourKey, 3600);
  }

  const snapPruned = await pruneSnapshots(cfg.retentionDays);
  const srcPruned = await pruneArticleSourceSnapshots(cfg.retentionDays);
  const authorPruned = await pruneArticleAuthorSnapshots(cfg.retentionDays);
  const monPruned = await pruneMonitors(cfg.windowHours);

  return {
    ok: true,
    sites: perSite,
    pruned: {
      snapshots: snapPruned,
      monitors: monPruned,
      sources: srcPruned,
      authors: authorPruned,
    },
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
