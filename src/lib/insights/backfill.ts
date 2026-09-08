import { randomBytes } from "node:crypto";
import {
  getBreakdownPaged,
  PlausibleApiError,
  type BreakdownRow,
} from "@/lib/plausible";
import { getRedis } from "@/lib/redis";
import { getDb, hasDb } from "@/lib/db";
import {
  getInsightsConfig,
  listWeekLedger,
  upsertWeekLedger,
  writeWeekRows,
  syncTitlesFromMonitor,
  articleRegexFor,
} from "./store";
import {
  METRIC_TIERS,
  type BackfillChunkResult,
  type InsightsConfig,
  type MetricTier,
  type PageWeekRow,
  type WeekLedgerRow,
  type WeekRange,
} from "./types";
import { currentWeekStart, isCompleteWeek, recentWeeks } from "./weeks";

/**
 * Must match `maxDuration` on the route. The loop stops early enough to finish
 * its writes rather than being killed mid-week.
 */
export const BACKFILL_MAX_DURATION_S = 300;
const DEADLINE_MS = (BACKFILL_MAX_DURATION_S - 60) * 1000;

const LOCK_TTL_S = BACKFILL_MAX_DURATION_S + 30;

/**
 * The Plausible rate limit is per API key, and the monitor spends from the same
 * key. Sharing its counter is deliberate: a private budget would let a backfill
 * trip a 429 that also takes the monitor down.
 */
function hourKey(): string {
  return `monitor:requests:${new Date().toISOString().slice(0, 13)}`;
}
const lockKey = (siteId: string) => `insights:backfill:lock:${siteId}`;
const cancelKey = (runKey: string) => `insights:backfill:cancel:${runKey}`;
const progressKey = (siteId: string) => `insights:backfill:progress:${siteId}`;

function isMetricUnsupportedError(e: unknown): boolean {
  if (!(e instanceof PlausibleApiError) || e.status !== 400) return false;
  const m = e.body.toLowerCase();
  return (
    m.includes("metric") ||
    m.includes("not supported") ||
    m.includes("bounce_rate") ||
    m.includes("visit_duration") ||
    m.includes("time_on_page") ||
    m.includes("visits") ||
    m.includes("invalid")
  );
}

function toRow(raw: BreakdownRow): PageWeekRow | null {
  const pagePath = String(raw.page ?? "");
  if (!pagePath.startsWith("/")) return null;
  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    pagePath,
    visitors: numOrNull(raw.visitors) ?? 0,
    pageviews: numOrNull(raw.pageviews) ?? 0,
    visits: numOrNull(raw.visits),
    bounceRate: numOrNull(raw.bounce_rate),
    visitDuration: numOrNull(raw.visit_duration),
    timeOnPage: numOrNull(raw.time_on_page),
  };
}

/**
 * Decide whether a week needs (re)fetching.
 *
 * The current week is always eligible — traffic is still accruing — and the
 * most recent complete week gets one settle-up pass after the grace period,
 * which flips `is_partial` off. After that a week is frozen.
 */
function needsFetch(
  week: WeekRange,
  ledger: Map<string, WeekLedgerRow>,
  config: InsightsConfig,
  now: Date
): boolean {
  const row = ledger.get(week.weekStart);
  if (!row) return true;
  if (row.status !== "ok") return true;
  if (row.truncated) return true;
  if (row.isPartial) return true;
  if (!row.fetchedAt) return true;
  const settleAt =
    new Date(`${week.weekEnd}T23:59:59Z`).getTime() +
    config.refetchGraceHours * 3600 * 1000;
  return new Date(row.fetchedAt).getTime() < settleAt && now.getTime() >= settleAt;
}

interface WeekFetchOutcome {
  rows: PageWeekRow[];
  apiCalls: number;
  truncated: boolean;
  tier: MetricTier;
}

async function fetchWeek(
  siteId: string,
  week: WeekRange,
  config: InsightsConfig,
  tier: MetricTier,
  pathFilter: string | null,
  allowTierStepDown: boolean
): Promise<WeekFetchOutcome> {
  let currentTier = tier;

  for (;;) {
    let apiCalls = 0;
    try {
      const { rows, truncated } = await getBreakdownPaged(
        siteId,
        {
          property: "event:page",
          metrics: METRIC_TIERS[currentTier],
          period: "custom",
          date: `${week.weekStart},${week.weekEnd}`,
          ...(pathFilter ? { filters: `event:page==${pathFilter}` } : {}),
        },
        {
          pageSize: config.pageLimit,
          maxPages: config.maxPagesPerWeek,
          onPage: () => {
            apiCalls += 1;
          },
        }
      );
      const mapped = rows
        .map(toRow)
        .filter((r): r is PageWeekRow => r !== null);
      return { rows: mapped, apiCalls, truncated, tier: currentTier };
    } catch (e) {
      // Only the probe may step down. Once a tier is proven for this run, a
      // later 400 means something else is wrong and retrying is exactly the
      // hammering we're trying to avoid.
      if (
        allowTierStepDown &&
        isMetricUnsupportedError(e) &&
        currentTier < METRIC_TIERS.length - 1
      ) {
        currentTier = (currentTier + 1) as MetricTier;
        continue;
      }
      throw e;
    }
  }
}

async function releaseLock(siteId: string, runKey: string): Promise<void> {
  try {
    // Check-and-delete: never stomp a successor's lock if we overran the TTL.
    await getRedis().eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      lockKey(siteId),
      runKey
    );
  } catch {
    // Lock expires on its own.
  }
}

export async function cancelBackfill(runKey: string): Promise<void> {
  try {
    await getRedis().set(cancelKey(runKey), "1", "EX", LOCK_TTL_S);
  } catch {
    // Nothing to do — the run will finish its chunk.
  }
}

export async function getBackfillProgress(
  siteId: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await getRedis().get(progressKey(siteId));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface BackfillOptions {
  weeks?: number;
  runKey?: string;
  startedBy?: string;
}

/**
 * Process up to N missing weeks and report how many remain. The client loops
 * until `remaining` is 0, which keeps every request inside the serverless
 * limit and makes a dropped response harmless — the next call re-derives the
 * work from the ledger.
 *
 * Abort boundaries:
 *  - per call: no retries;
 *  - per week: all-or-nothing, so a failure leaves the week absent, not half-written;
 *  - per run: the first week-level failure stops the loop, keeping the weeks
 *    that already committed.
 */
export async function runInsightsBackfill(
  siteId: string,
  opts: BackfillOptions = {}
): Promise<BackfillChunkResult> {
  const runKey = opts.runKey || randomBytes(8).toString("hex");
  const base: BackfillChunkResult = {
    ok: true,
    runKey,
    siteId,
    metricsTier: null,
    pathFilter: null,
    processed: [],
    remaining: 0,
    refreshedCurrentWeek: false,
    apiCallsUsed: 0,
    requestsThisHour: 0,
  };

  if (!hasDb()) {
    return { ...base, ok: false, skippedReason: "not_configured" };
  }

  const config = await getInsightsConfig();
  const redis = getRedis();

  // Deliberately fails CLOSED, unlike src/lib/rate-limit.ts which fails open by
  // design. A fail-open lock here means two concurrent backfills burning the
  // shared Plausible quota.
  let acquired: string | null;
  try {
    acquired = await redis.set(lockKey(siteId), runKey, "EX", LOCK_TTL_S, "NX");
  } catch {
    return { ...base, ok: false, skippedReason: "redis_unavailable" };
  }
  if (!acquired) return { ...base, ok: false, skippedReason: "locked" };

  const t0 = Date.now();
  let apiCallsUsed = 0;
  let requestsThisHour = 0;
  const processed: BackfillChunkResult["processed"] = [];
  let refreshedCurrentWeek = false;
  let tier: MetricTier = 0;
  let tierProven = false;
  let aborted: BackfillChunkResult["aborted"];

  try {
    requestsThisHour = Number((await redis.get(hourKey())) || 0);

    const ledgerRows = await listWeekLedger(siteId);
    const ledger = new Map(ledgerRows.map((r) => [r.weekStart, r]));
    // Reuse a tier already proven on this site rather than re-probing.
    const knownTier = ledgerRows.find((r) => r.metricsTier !== null)?.metricsTier;
    if (knownTier !== null && knownTier !== undefined) {
      tier = knownTier;
      tierProven = true;
    }

    const now = new Date();
    const thisWeek = currentWeekStart(now);
    const all = recentWeeks(config.backfillWeeks, now);
    const due = all.filter((w) => needsFetch(w, ledger, config, now));

    // The current week is always partial, so it must not count toward
    // `remaining` or the progress bar never reaches zero. Process it last.
    const dueComplete = due.filter((w) => isCompleteWeek(w, now));
    const dueCurrent = due.filter((w) => !isCompleteWeek(w, now));
    const queue = [...dueComplete, ...dueCurrent];

    const chunkSize = Math.min(
      Math.max(1, opts.weeks ?? config.weeksPerRequest),
      8
    );
    const vocabulary = new Set(config.sectionVocabulary);
    const articleRegex = articleRegexFor(config);
    const pathFilter = config.articlePathFilter.trim() || null;

    let done = 0;
    for (const week of queue) {
      if (done >= chunkSize) break;
      if (Date.now() - t0 > DEADLINE_MS) break;
      if (apiCallsUsed >= config.maxRequestsPerRun) break;

      try {
        if (await redis.get(cancelKey(runKey))) {
          await finishRun(runKey, "cancelled", null);
          return {
            ...base,
            ok: false,
            skippedReason: "cancelled",
            metricsTier: tier,
            pathFilter,
            processed,
            remaining: countRemaining(queue, processed, thisWeek),
            refreshedCurrentWeek,
            apiCallsUsed,
            requestsThisHour,
          };
        }
      } catch {
        // A Redis hiccup shouldn't kill an in-flight run; the lock still holds.
      }

      // Estimate conservatively so a chunk stops before tripping the shared cap.
      if (requestsThisHour + 3 > monitorHourlyCap(config)) {
        await finishRun(runKey, "rate_capped", null);
        return {
          ...base,
          ok: true,
          skippedReason: "rate_capped",
          metricsTier: tier,
          pathFilter,
          processed,
          remaining: countRemaining(queue, processed, thisWeek),
          refreshedCurrentWeek,
          apiCallsUsed,
          requestsThisHour,
        };
      }

      const isPartial = !isCompleteWeek(week, now);
      try {
        await writeProgress(siteId, runKey, week.weekStart, processed.length);

        const outcome = await fetchWeek(
          siteId,
          week,
          config,
          tier,
          pathFilter,
          !tierProven
        );
        tier = outcome.tier;
        tierProven = true;
        apiCallsUsed += outcome.apiCalls;
        requestsThisHour += outcome.apiCalls;
        await bumpHourCounter(outcome.apiCalls);

        const articleRows = outcome.rows.filter((r) =>
          articleRegex.test(r.pagePath)
        );
        const written = await writeWeekRows(
          siteId,
          week.weekStart,
          isPartial,
          articleRows,
          vocabulary,
          articleRegex
        );

        await upsertWeekLedger({
          siteId,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          status: "ok",
          isPartial,
          truncated: outcome.truncated,
          metricsTier: tier,
          rowsWritten: written,
          apiCalls: outcome.apiCalls,
          error: null,
        });

        processed.push({
          weekStart: week.weekStart,
          rows: written,
          apiCalls: outcome.apiCalls,
          truncated: outcome.truncated,
        });
        if (isPartial) refreshedCurrentWeek = true;
        done += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await upsertWeekLedger({
          siteId,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          status: "error",
          isPartial,
          truncated: false,
          metricsTier: tierProven ? tier : null,
          rowsWritten: 0,
          apiCalls: 0,
          error: message.slice(0, 500),
        });
        aborted = { weekStart: week.weekStart, stage: "fetch", error: message };
        const rateCapped =
          e instanceof PlausibleApiError && e.status === 429;
        await finishRun(runKey, rateCapped ? "rate_capped" : "error", message);
        return {
          ...base,
          ok: false,
          skippedReason: rateCapped ? "rate_capped" : undefined,
          metricsTier: tierProven ? tier : null,
          pathFilter,
          processed,
          remaining: countRemaining(queue, processed, thisWeek),
          refreshedCurrentWeek,
          apiCallsUsed,
          requestsThisHour,
          aborted,
        };
      }
    }

    if (processed.length > 0) {
      await syncTitlesFromMonitor(siteId).catch(() => 0);
    }

    const remaining = countRemaining(queue, processed, thisWeek);
    await finishRun(runKey, remaining === 0 ? "done" : "running", null);

    return {
      ...base,
      ok: true,
      metricsTier: tierProven ? tier : null,
      pathFilter,
      processed,
      remaining,
      refreshedCurrentWeek,
      apiCallsUsed,
      requestsThisHour,
    };
  } finally {
    await releaseLock(siteId, runKey);
    try {
      await redis.del(progressKey(siteId));
    } catch {
      // best effort
    }
  }
}

function countRemaining(
  queue: WeekRange[],
  processed: BackfillChunkResult["processed"],
  currentWeek: string
): number {
  const done = new Set(processed.map((p) => p.weekStart));
  return queue.filter((w) => w.weekStart !== currentWeek && !done.has(w.weekStart))
    .length;
}

function monitorHourlyCap(config: InsightsConfig): number {
  // The shared cap lives on monitor_config; using the run budget as the floor
  // keeps this honest even when the monitor is configured very low.
  return Math.max(config.maxRequestsPerRun, 240);
}

async function bumpHourCounter(calls: number): Promise<void> {
  if (calls <= 0) return;
  try {
    const redis = getRedis();
    const key = hourKey();
    await redis.incrby(key, calls);
    await redis.expire(key, 3600);
  } catch {
    // Budget accounting is best-effort; the per-run cap still applies.
  }
}

async function writeProgress(
  siteId: string,
  runKey: string,
  week: string,
  done: number
): Promise<void> {
  try {
    await getRedis().set(
      progressKey(siteId),
      JSON.stringify({ runKey, week, done, at: Date.now() }),
      "EX",
      600
    );
  } catch {
    // Progress is a nicety, never a correctness input.
  }
}

export async function startRun(
  runKey: string,
  siteId: string,
  startedBy: string
): Promise<void> {
  if (!hasDb()) return;
  await getDb()
    .query(
      `INSERT INTO insights_backfill_runs (run_key, site_id, started_by)
       VALUES ($1, $2, $3) ON CONFLICT (run_key) DO NOTHING`,
      [runKey, siteId, startedBy]
    )
    .catch(() => {});
}

async function finishRun(
  runKey: string,
  status: string,
  error: string | null
): Promise<void> {
  if (!hasDb()) return;
  await getDb()
    .query(
      `UPDATE insights_backfill_runs
          SET status = $2, error = $3,
              finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE NOW() END
        WHERE run_key = $1`,
      [runKey, status, error ? error.slice(0, 500) : null]
    )
    .catch(() => {});
}
