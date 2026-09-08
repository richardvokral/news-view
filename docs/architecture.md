# Architecture overview

One Next.js 16 (App Router) app on Vercel. State is split by durability: **Neon Postgres** for anything that must survive (articles, ACL, monitor snapshots, proofread config/usage, layouts) and **Redis** for the hot path (caches, quota counters, settings overrides, locks). External work is driven by **QStash crons** hitting `/api/cron/*`.

```
                       ┌────────────────────────── Vercel (Next.js 16) ──────────────────────────┐
 News APIs / RSS ──────▶ /api/cron/fetch-news ─▶ fetchers ─▶ storage/articles ─▶ clustering ─▶ /news, /reports
 Plausible  ◀──────────  /api/cron/article-monitor ─▶ monitor/pipeline ─▶ snapshots ─▶ /monitor
 Competitor RSS ───────▶ /api/cron/coverage ─▶ external-rss + AI ─▶ coverage_analysis ─▶ /monitor (Coverage)
 Google Trends ────────▶ monitor/google-trends ──────────────────────────────▶ /monitor (sidebar)
 Plausible  ◀──────────  /api/insights/backfill ─▶ weekly aggregates ─▶ /insights
 Anthropic / OpenAI ◀──  clustering · analyze · proofread · coverage · insights
 CMS (Chrome ext) ─────▶ /api/extension/* + /api/proofread  (bearer tokens)
 Logto OIDC ◀──────────  middleware cookie gate + getSession() per route
                       └────────────── Neon Postgres ─── Redis (ioredis) ────────────────────────┘
```

## Feature surfaces

| Surface | Section (ACL) | What it shows | Deep-dive doc |
| --- | --- | --- | --- |
| `/news` | `news` | Ingested articles clustered into topics (keyword/AI/hybrid). | [`news-pipeline.md`](news-pipeline.md) |
| `/reports` | `reports` | Widget dashboard over the Plausible stats API; per-user + admin-default layouts. | [`news-pipeline.md`](news-pipeline.md) |
| `/monitor` | `monitor` | Near-real-time per-article traffic, sources, authors, title history, competitor coverage, Trends. | [`article-monitor.md`](article-monitor.md) |
| `/analyze` | `reports` | Natural-language Q&A over Plausible via Claude tool use (SSE). | [`news-pipeline.md`](news-pipeline.md) |
| `/insights` | `insights` | Long-horizon most-read articles (weekly aggregates in Postgres) + AI theme analysis. | [`insights.md`](insights.md) |
| `/admin/*` | admin only | ACL, settings, monitor config, proofread console, migrations. | [`auth-and-admin.md`](auth-and-admin.md) |
| Chrome extension | ACL via bearer | Czech proofreading inside the CMS editor. | [`proofread.md`](proofread.md) |

## Layering rules

- **Routes** (`src/app/**`) are thin: auth check (`getSession()` + section/admin) — required in every handler, middleware is not a substitute — then parse, delegate to `src/lib`, return JSON `{...}` / `{error}`.
- **`src/lib`** is server-only; never import it from a `"use client"` component. Feature UI lives in `src/components/<feature>/`.
- **Pluggable-source pattern**: external integrations sit behind a shared contract per domain — `fetchers/types.ts` (news sources), `clustering/types.ts` (strategies), proofread's provider modules. The planned analytics-provider abstraction (`docs/plans/article-insights-providers.md`) extends the same idiom to Plausible/GA4/etc.
- **Settings**: runtime feature settings go through `storage/settings.ts` (Redis override → env default) or feature-specific Postgres singletons (`monitor_config`, `proofread_settings`, `insights_config`). Direct `process.env` reads are reserved for secrets/infra.
- **Degradation**: `hasDb()`/missing keys make features no-op or fall back (keyword clustering, empty monitor, Redis-only articles) rather than crash.

## Auth in one paragraph

Edge middleware only checks that a Logto cookie *exists* on protected prefixes — a forged cookie passes it, so it is a redirect convenience, not a gate. Real authorization happens per request, in **every** route handler and page: `getSession()` resolves email → admin bypass (`ADMIN_EMAILS`) or DB ACL (`access_users` exact row wins, even empty; else `access_domains`), yielding `sections ⊆ {reports, news, monitor, insights}`. `/api/cron/*` is exempt from cookies and authenticates with `CRON_SECRET` instead, failing closed. The Chrome extension bypasses cookies entirely with 30-day hashed bearer tokens that re-check ACL on every call. Details: [`auth-and-admin.md`](auth-and-admin.md).

## Deployment model

Pushes to the default branch (`claude/news-aggregator-tool-HvXDC`) auto-deploy to production — there is no staging. `npm run build` + `npm run lint` are the pre-push bar (no test runner yet). Secrets live in Vercel env; schema changes are idempotent SQL applied at runtime via `/admin/database`. The `extension/` folder is excluded from deploys (`.vercelignore`) and loaded unpacked in the browser.

## Docs map

- [`vision.md`](vision.md) — why the product exists and where it's going.
- [`updates.md`](updates.md) — human-readable change log.
- [`article-monitor.md`](article-monitor.md) — monitor pipeline runbook + internals.
- [`news-pipeline.md`](news-pipeline.md) — ingestion, clustering, dashboards, analyze.
- [`proofread.md`](proofread.md) — proofreading backend + extension.
- [`auth-and-admin.md`](auth-and-admin.md) — auth, ACL, DB/Redis, cron, env.
- [`insights.md`](insights.md) — weekly Plausible backfill + AI theme analysis.
- [`plans/article-insights-providers.md`](plans/article-insights-providers.md) — design: analytics-provider-agnostic insight tracking.
