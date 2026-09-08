# Article monitor

Near-real-time per-article performance tracking for editors. A cron-driven pipeline polls Plausible for per-page visitors/pageviews, snapshots them into Postgres, enriches them with RSS titles/images, source and author breakdowns, Google Trends, and an AI-powered competitor-coverage comparison. Editors watch it all on `/monitor`.

> Making this pipeline analytics-platform-agnostic (GA4, Matomo, Gemius, …) is the current design priority — see [`docs/plans/article-insights-providers.md`](plans/article-insights-providers.md).

## How it works

### The tick (`src/lib/monitor/pipeline.ts` → `runMonitorTick`)

QStash (or the `/admin/monitor` "Run now" button) hits `POST /api/cron/article-monitor` with `Authorization: Bearer $CRON_SECRET`. Each tick:

1. **Config + guards.** Loads the `monitor_config` singleton (`src/lib/monitor/config.ts`). Exits early with `skippedReason: "disabled"` / `"no_sites"` / `"rate_capped"`. The rate cap is a Redis hourly counter (`monitor:requests:<YYYY-MM-DDTHH>`) checked against `maxRequestsPerHour`; every Plausible call made increments it.
2. **RSS prefetch** (if `rssEnabled`). One HTTP fetch per site with a configured feed URL (`siteRssUrls`), parsed by the dependency-free RSS 2.0 parser in `src/lib/monitor/rss.ts` (titles, links → page paths, enclosure images, pubDate; handles CDATA and `szn:image`). Doesn't consume the Plausible budget.
3. **Per-site page breakdown.** One Plausible `breakdown` call per site: `property=event:page`, `metrics=visitors,pageviews`, limit 100, over a rolling day range from `plausibleDayRange(windowHours)` (`src/lib/plausible.ts`) — a `period=custom` spanning enough calendar days to cover `windowHours`, which is what stops counts from collapsing at UTC midnight.
4. **Filter to articles.** Rows are matched against the per-site regex from `sitePatterns` (e.g. `^/(a|clanek)/`); an empty/invalid pattern falls back to "any non-root path" (`buildSiteRegex`).
5. **Persist.** Each matching row is upserted into `article_monitors` (keyed by `page_path`) and a row is appended to `article_metric_snapshots` (raw cumulative visitors/pageviews at `captured_at`). If the RSS feed had this path and the title *or* image changed vs. the latest stored row, a new append-only row goes into `article_titles` (this powers title-change history).
6. **Source sampling** (if `sourceSamplingEnabled`). For the top `sourceSamplingTopN` articles by visitors, one extra Plausible call each (`property=visit:source`, filtered to the page, limit 5) → `article_source_snapshots`. The pipeline pre-checks that `sites + N×sites (+ N×sites for authors)` fits the hourly budget and skips sampling (with a console warning) if not.
7. **Author sampling** (if `authorSamplingEnabled`). Same top-N pattern, using the custom `author` goal (`property=event:props:name`, `filters=event:goal==author;event:page==<path>`) → `article_author_snapshots`. Requires the sites to send an `author` custom event to Plausible.
8. **Prune.** Metric/source/author snapshots older than `retentionDays`; monitor rows untouched for `windowHours + 24h`.

The tick returns `{ ok, skippedReason?, sites: [{siteId, articles, sources, authors, titles}], pruned, requestsThisHour }` and is idempotent — re-running just appends another snapshot.

### Derived metrics (computed at read time, not stored)

- **Trend flame** — `computeTrendScore` (`src/lib/monitor/trend.ts`): least-squares slope of visitors over the last `trendWindowMinutes`, displayed as `+N/m`.
- **First-hour KPI** — `computeFirstHourGrowth`: visitor count at ~60min (±10min) after `first_seen_at`.
- Sparklines plot raw cumulative snapshots; the big number is the latest snapshot.

### Sidecar features

- **Coverage tab** (`src/lib/monitor/coverage.ts`, `external-rss.ts`): ingests competitor RSS feeds (`externalRssUrls`) into `external_articles`, then asks Claude (`coverageModel`, default Haiku) whether each external story is covered by any of our recent titles → `coverage_analysis` (covered flag, importance 1–5, matched paths, rationale). Runs via `POST /api/cron/coverage` or the admin "run" button; browsed at `/monitor` → Coverage.
- **Google Trends sidebar** (`src/lib/monitor/google-trends.ts`): fetches `trends.google.com/trending/rss?geo=<locale>` per configured locale (direct first, scrape.do fallback via `SCRAPEDO_TOKEN` when blocked), caches into `google_trends_snapshots`.
- **Site URL mapping** (`src/lib/monitor/site-urls.ts`): article links assume `https://<siteId>`; override with `PLAUSIBLE_SITE_BASEURLS` (`siteId=https://host;…`).

## Data model (`src/lib/db-schema.sql`)

| Table | Keyed by | Contents |
| --- | --- | --- |
| `article_monitors` | `page_path` (PK) | One row per tracked article: `site_id`, `first_seen_at`, `last_checked_at`, `metadata` JSONB. |
| `article_metric_snapshots` | serial, FK → monitors | Append-only `(captured_at, window_seconds, visitors, pageviews)` — raw cumulative values from Plausible. |
| `article_source_snapshots` | serial, FK | `(captured_at, source, visitors)` per sampled article. |
| `article_author_snapshots` | serial, FK | `(captured_at, name, visitors)` per sampled article. |
| `article_titles` | serial, FK | Append-only title/image/pubDate history; new row only on change. |
| `external_articles` | `(feed_source, guid)` unique | Competitor RSS items. |
| `coverage_analysis` | `(our_site_id, external_article_id)` unique | AI verdicts: `covered`, `importance`, `matched_our_paths`, `rationale`, `model`. |
| `google_trends_snapshots` | serial | Cached trends per `(locale, fetched_at)`. |
| `monitor_config` | singleton `id=1` | All knobs below. |

All FKs cascade on delete, so pruning `article_monitors` cleans up snapshots/titles.

## Configuration (`/admin/monitor` → `monitor_config`)

Everything is runtime-editable by an admin; no redeploys. Saved via `PUT /api/admin/monitor-config` with clamping in `saveMonitorConfig` (`config.ts`).

| Knob | Default | Notes |
| --- | --- | --- |
| `enabled` | `false` | Master switch; cron no-ops until flipped. |
| `intervalSeconds` | `300` | Expected cron cadence (min 60). Stored on each snapshot as `window_seconds`. |
| `windowHours` | `48` | How recent an article must be to appear; also the Plausible query range. |
| `retentionDays` | `7` | Snapshot pruning horizon. |
| `maxRequestsPerHour` | `240` | Redis-backed Plausible budget. |
| `sitePatterns` | `{}` | Per-site article-URL regex. |
| `sourceSamplingEnabled` / `sourceSamplingTopN` | `false` / `10` | Per-article `visit:source` breakdowns (top N, clamp 1–50). |
| `authorSamplingEnabled` | `false` | Per-article author breakdowns via the `author` goal. |
| `authorShortNames` | `{}` | Display-name mapping. |
| `trendWindowMinutes` | `60` | Flame slope window (clamp 5–1440). |
| `sourceTimeseriesEnabled` | `false` | Per-article source chart in the detail drawer. |
| `excludedSources` / `topSourcesLimit` | `[]` / `10` | Top-sources widget tuning (limit clamp 3–50). |
| `rssEnabled` / `siteRssUrls` | `false` / `{}` | Title/image sync from own-site RSS. |
| `showArticleImages` | `false` | Thumbnails in the table. |
| `externalRssEnabled` / `externalRssUrls` | `false` / `[]` | Competitor feeds for Coverage. |
| `coverageEnabled` / `coverageWindowHours` / `coverageModel` | `false` / `24` / `claude-haiku-4-5…` | AI coverage cross-reference. |
| `googleTrendsEnabled` / `googleTrendsLocales` | `false` / `["CZ","DE","US"]` | Trends sidebar (max 3 locales). |

**Plausible budget math**: base cost per tick = 1 call × sites. With source *and* author sampling at Top-10 on 2 sites: `2 + 20 + 20 = 42` calls per tick → 504/hour at 5-min cadence, which *exceeds* the default 240 cap — sampling passes will skip. Either raise the cap, lower Top-N, or slow the cadence.

## API surface

All `/api/monitor/*` endpoints require a Logto session with the `monitor` section (`getSession()` + `sections.includes("monitor")`); admin endpoints additionally require `ADMIN_EMAILS`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/monitor/articles` | Articles seen within the window + snapshots, latest title/image, top authors (`listArticlesWithRecentStats`, limit 200 articles / 48 snapshots each). |
| `GET /api/monitor/article-snapshots` | Full snapshot history for one article. |
| `GET /api/monitor/article-sources` | Latest per-source visitors for one article (stored + live Plausible fallback). |
| `GET /api/monitor/source-contributions` | Source timeseries for the detail chart. |
| `GET /api/monitor/sources` | Site-wide top sources widget. |
| `GET /api/monitor/authors` | Author leaderboard. |
| `GET /api/monitor/article-titles` | Title history for one article. |
| `GET /api/monitor/coverage` | Coverage rows for the tab. |
| `GET /api/monitor/google-trends` | Cached trends per locale. |
| `POST /api/cron/article-monitor` | The tick (Bearer `CRON_SECRET`). |
| `POST /api/cron/coverage` | External ingest + AI analysis (Bearer `CRON_SECRET`). |
| `GET/PUT /api/admin/monitor-config` | Read/save config (admin). |
| `POST /api/admin/monitor-run`, `/api/admin/coverage-run` | Manual tick triggers (admin). |

UI: `/monitor` (`src/app/monitor/page.tsx` → `MonitorPageShell` → `MonitorDashboard` + `CoverageTab` + `GoogleTrendsSidebar`); config UI at `/admin/monitor` (`MonitorConfigForm`).

## Runbook

1. **Migrate the DB** (once): `/admin/database` → Run migrations (or `POST /api/admin/migrate` as admin).
2. **Grant access**: `/admin/users` or `/admin/domains`, tick the `monitor` section.
3. **Configure** at `/admin/monitor`: enable, set per-site article regex, tune knobs above.
4. **Schedule the cron** in Upstash QStash: `POST https://<host>/api/cron/article-monitor`, header `Authorization: Bearer $CRON_SECRET`, cadence matching `intervalSeconds` (default every 5 min). Add a second schedule for `/api/cron/coverage` if the Coverage tab is enabled (hourly is plenty). `CRON_SECRET` must be set in Vercel — the cron gate fails closed without it, and a QStash signature header alone is not accepted.
5. Wait one tick (or "Run now" at `/admin/monitor`). `/monitor` populates.

### Env vars used by this feature

`PLAUSIBLE_API_URL`, `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_IDS` (semicolon-separated), `PLAUSIBLE_SITE_BASEURLS` (optional), `CRON_SECRET`, `SCRAPE_DO_TOKEN` (optional, Trends fallback), `ANTHROPIC_API_KEY` (Coverage), plus `DATABASE_URL` / `STORAGE_REDIS_REDIS_URL`.

## Failure modes

- **Plausible 4xx/5xx on one site**: logged; that site records 0 articles for the tick; other sites unaffected.
- **Over the rate cap**: tick returns `skippedReason: "rate_capped"`; counter expires with the hour.
- **Sampling over budget**: article pass still runs; source/author sampling skipped with a console warning.
- **RSS/Trends fetch failure**: degrades to empty results, never fails the tick.
- **Day-boundary artifacts**: visitors are cumulative over the rolling day range; small "steps" can still appear when the range window slides. Raw values are stored and displayed as-is.
- **No DB configured** (`hasDb()` false): all queries no-op; config falls back to `DEFAULT_MONITOR_CONFIG`.
- **`CRON_SECRET` unset or rotated without updating QStash**: every tick returns 401 and the monitor quietly stops. Check the QStash delivery log first when `/monitor` goes stale.

## Known gaps / future work

- Single analytics provider (Plausible) — see the provider-abstraction design doc.
- Alerting: trend/first-hour signals are display-only; no Slack/email notifications yet.
- Cross-site article de-dup.
- OG-tag scraping fallback for sites without a usable RSS feed.
- Per-site ACL (the `monitor` section is all-or-nothing).
