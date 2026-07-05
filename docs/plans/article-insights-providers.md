# Product design: ubiquitous article insight tracking

**Status:** Draft for review · **Owner:** Richard · **Date:** 2026-07-05

## Problem

Article insight tracking (the `/monitor` pipeline) is hard-wired to Plausible:

- The **site list** comes from `PLAUSIBLE_SITE_IDS` (env), so adding a property means a Vercel env change + redeploy, and every property must run Plausible.
- The **metric fetch** calls the Plausible v1 stats API directly (`src/lib/plausible.ts` → `getBreakdown` in `src/lib/monitor/pipeline.ts`).
- **Plausible semantics leak everywhere**: cumulative-since-midnight visitors shape the sparkline, the trend slope, the day-range workaround (`plausibleDayRange`), and the UI copy. Source attribution (`visit:source`) and author attribution (`event:goal==author` custom props) are Plausible query dialect.
- The reports dashboard (`/reports`), Analyze tool, and source filter also call Plausible directly, but the monitor is the highest-value and most self-contained surface to generalize first.

Echo Media properties (and potential partner/acquired sites) run different analytics stacks — Google Analytics 4 is the most common, Matomo appears in self-hosted setups, and Gemius is the Czech industry-measurement standard. Today none of them can appear on `/monitor`. The goal is that **any property can be tracked with the same sparklines, flames, source breakdowns, and coverage cross-references, regardless of its analytics platform**.

## Goals

1. A property on GA4 (first non-Plausible target) shows up on `/monitor` with parity for the core loop: article discovery, visitor/pageview snapshots, sparkline, trend flame, first-hour KPI, RSS titles, coverage.
2. Sites are **registered at runtime** (admin UI + DB), not via env-var redeploys.
3. Provider differences are expressed as **declared capabilities**, and the UI degrades gracefully (e.g. no author breakdown on a provider that can't do it) instead of erroring.
4. Existing Plausible installs migrate with **zero data loss and zero config re-entry**.
5. The abstraction leaves room for a **push/ingest mode** (platforms we can't poll send us data) without redesign.

### Non-goals (this iteration)

- Porting `/reports`, `/analyze`, and the widget dashboard off direct Plausible calls (they keep working as-is; follow-up).
- Historical backfill from the new providers — the monitor is intentionally a rolling window.
- Sub-minute "true realtime"; we stay on the snapshot cadence model.

## Design overview

### 1. `InsightsProvider` interface (`src/lib/insights/types.ts`)

One narrow, monitor-shaped interface — deliberately *not* a generic analytics client. The pipeline needs exactly three read operations:

```ts
export interface PageMetricsRow {
  pagePath: string;        // normalized: leading slash, no query/hash
  visitors: number;
  pageviews: number;
}

export interface InsightsProvider {
  readonly kind: "plausible" | "ga4" | "matomo" | "gemius" | "push";
  readonly capabilities: {
    pageMetrics: true;           // required baseline
    sourceBreakdown: boolean;    // per-article referrer/channel split
    authorBreakdown: boolean;    // per-article author custom dimension
    realtimeVisitors: boolean;   // site-wide "now" number
  };
  /** Top pages by visitors within the window. The workhorse call. */
  fetchPageMetrics(site: SiteConfig, window: TimeWindow, limit: number): Promise<PageMetricsRow[]>;
  fetchSourceBreakdown?(site: SiteConfig, pagePath: string, window: TimeWindow, limit: number): Promise<{ source: string; visitors: number }[]>;
  fetchAuthorBreakdown?(site: SiteConfig, pagePath: string, window: TimeWindow, limit: number): Promise<{ name: string; visitors: number }[]>;
  fetchRealtimeVisitors?(site: SiteConfig): Promise<number>;
  /** Validate credentials/config; used by the admin "Test" button. */
  test(site: SiteConfig): Promise<{ ok: boolean; message?: string }>;
}
```

Key semantic decision: `fetchPageMetrics` returns **totals over the requested window**, not provider-native cumulative curves. The *snapshot* mechanism (append a reading every tick, plot the series) stays in our pipeline and is provider-independent — which is exactly how it already works; Plausible's cumulative number is just "total over the day range". This means sparklines, `computeTrendScore`, and `computeFirstHourGrowth` need **no changes**: they operate on our snapshots, not on provider data shapes.

### 2. Site registry: `monitored_sites` table (replaces `PLAUSIBLE_SITE_IDS`)

```sql
CREATE TABLE IF NOT EXISTS monitored_sites (
  id TEXT PRIMARY KEY,              -- stable slug, e.g. "echo24.cz" (keeps FK-compat with article_monitors.site_id)
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'plausible',
  provider_config JSONB NOT NULL DEFAULT '{}',  -- provider-specific: property id, secret *reference*, host, …
  base_url TEXT,                    -- replaces PLAUSIBLE_SITE_BASEURLS
  article_pattern TEXT,             -- absorbs monitor_config.site_patterns
  rss_url TEXT,                     -- absorbs monitor_config.site_rss_urls
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `article_monitors.site_id` already stores the Plausible site id as text, so existing rows keep working unchanged.
- Per-site settings currently scattered across `monitor_config` JSONB maps (`sitePatterns`, `siteRssUrls`) and env (`PLAUSIBLE_SITE_BASEURLS`) consolidate here; `monitor_config` keeps only global knobs (cadence, retention, budgets, feature toggles).
- **Secrets stay out of the DB.** `provider_config` stores non-secret identifiers (GA4 property id, Matomo site id + host) and a *secret reference* — the name of the env var holding the credential (e.g. `{"credentialEnv": "GA4_SA_KEY_ECHO24"}`). Rationale: the DB is reachable from more code paths than env, and Vercel env is the existing secret store. Multiple sites can share one credential env var.
- Admin UI: new `/admin/sites` page — list, add/edit form with provider dropdown, provider-specific fields, and a **Test connection** button calling `provider.test()`.
- **Compat shim:** if the table is empty and `PLAUSIBLE_SITE_IDS` is set, the registry synthesizes Plausible site entries from env at read time (and the admin page offers "import from env → DB"). Nothing breaks on deploy day.

### 3. Providers

| Provider | Page metrics | Sources | Authors | Realtime | Notes |
| --- | --- | --- | --- | --- | --- |
| **Plausible** (extract existing) | `breakdown event:page` | `visit:source` | `event:props:name` + `author` goal | v1 realtime | Behavior-identical port of today's code. |
| **GA4** (first new) | Data API `runReport`, dimension `pagePath`, metrics `totalUsers`,`screenPageViews` | dimension `sessionSource` (or `sessionDefaultChannelGroup`) filtered by page | custom dimension (requires site-side setup; declared per-site in `provider_config`) | `runRealtimeReport` | Auth: service-account JSON via secret ref. Quota: Data API core tokens are generous vs. our call volume, but track cost per call in the same Redis budget. |
| **Matomo** (fast follow) | `Actions.getPageUrls` | `Referrers.*` filtered by page (via segment) | custom dimension API | `Live.getCounters` | Simple token auth; good self-hosted story. |
| **Gemius** (investigate) | API access is contract-dependent | — | — | — | Spike first: confirm API availability before committing. |
| **Push** (later phase) | `POST /api/insights/push` ingests `PageMetricsRow[]` batches with per-site bearer tokens | same payload | same | n/a | For platforms with no pollable API; the "provider" just reads the latest pushed batch from Redis. |

Provider modules live in `src/lib/insights/providers/<kind>.ts` with a `getProvider(kind)` registry in `src/lib/insights/index.ts`, mirroring the existing `src/lib/fetchers/` pattern (pluggable modules behind a shared `types.ts` contract) so the codebase has one idiom for "pluggable external source".

### 4. Pipeline changes (`src/lib/monitor/pipeline.ts`)

- Iterate `listEnabledSites()` from the registry instead of `listSiteIds()`.
- Replace direct `getBreakdown(...)` calls with `provider.fetchPageMetrics(...)` / `fetchSourceBreakdown(...)` / `fetchAuthorBreakdown(...)`, skipping sampling passes when the capability is absent (today's budget-skip logic already handles per-pass skipping — capability checks slot into the same branch).
- Rate budget becomes **per provider**: Redis key `insights:requests:<provider>:<hour>`, with per-provider caps in `monitor_config` (GA4 and Plausible budgets shouldn't share one counter).
- `plausibleDayRange` moves into the Plausible provider — it's a Plausible dialect detail. The pipeline passes an abstract `TimeWindow { hours }`.
- Snapshot tables gain nothing: rows are provider-agnostic already. We add `article_monitors.metadata.provider` (JSONB, no migration) for display/debugging.

### 5. UI changes

- Site filter dropdown reads the registry (labels instead of raw ids).
- Detail drawer hides source/author panels when the site's provider lacks the capability (the API responses gain a `capabilities` field so the client doesn't guess).
- Admin: `/admin/sites` (new), `/admin/monitor` sheds the per-site pattern/RSS maps (moved to the site form) — less JSON-in-a-textarea.

### 6. Metric semantics (the hard part, made explicit)

| Concern | Decision |
| --- | --- |
| "Visitors" ≠ same thing everywhere (Plausible visitors vs GA4 totalUsers vs Matomo visits) | Accept per-provider definitions; label the metric per site in the UI tooltip ("GA4 users"). Cross-site *ranking* within one site is what editors use; cross-provider absolute comparison is documented as approximate. |
| Cumulative windows | Providers return window totals; our snapshot series stays "reading per tick", so all derived math is unchanged. |
| Sampling/thresholding (GA4 sampling, Plausible ≥1 visitor floor) | Store what the API returns; note per-provider caveats in docs. No correction attempts. |
| Timezones | `TimeWindow` is UTC-based like today; GA4 property timezone can shift day-bucket edges — acceptable for a rolling window, documented. |

## Rollout plan

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **1. Extract** (no behavior change) | Create `src/lib/insights/` types + Plausible provider wrapping existing code; pipeline consumes the interface; env-based site shim. | `/monitor` output byte-identical on prod; tick result JSON unchanged. |
| **2. Registry** | `monitored_sites` table + migration, `/admin/sites` UI, import-from-env, per-site pattern/RSS/base-url move. | Sites manageable without env changes; existing config visible in the new UI. |
| **3. GA4 provider** | Data API client, service-account auth via secret ref, capability-aware sampling, per-provider budgets, `test()`. | A GA4 demo property renders sparkline + flame + first-hour KPI on `/monitor`. |
| **4. Capability polish** | UI degradation, per-provider metric labels, docs. | Mixed-provider `/monitor` reads cleanly; no dead panels. |
| **5. Reach** (separate follow-ups) | Matomo provider; Gemius spike; push-ingest API; Slack/email spike alerts (consumes the same snapshots); per-article stats surfaced in the Chrome extension. | Each shipped independently. |

Phases land in order, each independently deployable to the default branch (per the repo's push-to-prod workflow), each behind existing behavior until config opts in.

## Risks & mitigations

- **GA4 quota/latency surprises** → per-provider Redis budgets from day one; `test()` reports quota errors; cadence configurable per install.
- **Semantic confusion between providers** → explicit per-site metric labels; docs section above; no silent cross-provider aggregation.
- **Registry/env drift during migration** → compat shim + one-click import; remove `PLAUSIBLE_SITE_IDS` reading only in a later cleanup once prod runs on the registry.
- **Scope creep into `/reports`/`/analyze`** → explicitly out of scope; those stay Plausible-only until the monitor abstraction proves itself.
- **Secrets in DB temptation** → secret-reference convention enforced in code review; `provider_config` is documented as non-secret.

## Open questions (decide before Phase 3)

1. GA4 attribution source: `sessionSource` (closest to Plausible `visit:source`) vs `sessionDefaultChannelGroup` (cleaner buckets: Search/Discover/Social)? Leaning `sessionDefaultChannelGroup` — it matches how editors think.
2. Does any target property already have a GA4 author custom dimension, or do we treat `authorBreakdown: false` as the GA4 norm initially?
3. Gemius: is programmatic API access included in Echo Media's contract? (Blocks/unblocks the Gemius provider entirely.)
4. Should the push-ingest API launch alongside Phase 3 (some properties may have *no* pollable analytics), or stay Phase 5?
