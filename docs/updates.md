# Updates

Reverse-chronological log of notable changes. One entry per meaningful shipment, not per commit — see `git log` for the full history. Add a new entry (top of the list) whenever you land a user-visible feature, a new integration, a schema change, or an operational change.

## 2026-07

- **Documentation overhaul.** Added the `docs/` set: architecture overview, per-subsystem docs (monitor, news pipeline, proofread, auth/admin), product vision, this updates log, and a product design doc for making article insight tracking analytics-provider-agnostic (`docs/plans/article-insights-providers.md`).

## 2026-06

- **Proofread input hardening.** Article text is passed to the LLM inside tagged content blocks; OpenAI calls use Structured Outputs so the suggestion JSON can't drift from the schema.

## 2026-05

- **Korektor (ÚFAL) pre-filter** for proofreading — optional `off`/`parallel`/`sequential` modes, configurable endpoint and model at `/admin/proofread/korektor`. Off by default (hosted API is non-commercial without a written agreement).
- **Admin Database page** with a "Run migrations" button (`/admin/database`), replacing the DevTools `fetch("/api/admin/migrate")` ritual.
- **AI Czech proofreading (Stage 1)** — `/api/proofread` backend with per-mode prompts, per-user model/prompt overrides, USD/CZK usage accounting, and an admin console under `/admin/proofread`. Ships with a Chrome/Edge MV3 extension (`extension/`) that authenticates via `/api/extension/login` bearer tokens and applies suggestions inside the CMS editor.
- **Analyze tab** — natural-language Q&A over Plausible using Claude tool use (`/analyze`).

## 2026-04 (late)

- **Midnight fixes.** Article stats no longer collapse at UTC midnight: the monitor queries a rolling multi-day Plausible range (`plausibleDayRange`) sized to `windowHours` instead of `period=day`.
- **CPU/cost reduction.** Dashboard polling pauses on hidden tabs; article fetches are cached.

## 2026-04-20 — Monitor feature burst

- Sortable columns, column filters, source filter, per-article detail drawer on `/monitor`.
- First-hour KPI, per-article source timeseries chart, excluded-sources config, window picker.
- RSS title sync (append-only `article_titles` history + title-change lightbulb), article images, author sampling with short-name mapping.
- Flame indicator (trend slope), hide-in-page, top-sources diagnostics, adjustable sampling Top-N.
- **Coverage tab**: competitor RSS ingest (`external_articles`) + AI cross-reference against our recent titles (`coverage_analysis`).
- **Google Trends sidebar**: direct RSS fetch with scrape.do fallback, cached per locale in `google_trends_snapshots`.
- Brute-force hardening on `/api/auth`.

## 2026-04-19 — Phase B: Article Monitor + auth

- Plausible reports dashboard, Logto OIDC auth, per-section access control (users + domains), admin area (`/admin/*`).
- Article monitor: `monitor_config` singleton, cron pipeline behind `CRON_SECRET`, `/monitor` sparkline table, `/admin/monitor` config UI, "Run now" button.
- Removed legacy password-gate settings flow in favor of Logto.

## 2026-04-18

- PostgreSQL (Neon) storage for articles, OpenAI clustering option, stats dashboard, Logto scaffold, WorldNewsAPI dedup, clustering result cache, hybrid AI mode, DE title translation, five international RSS sources.

## 2026-03

- Initial tool: news fetchers, keyword clustering, Redis via ioredis (`STORAGE_REDIS_REDIS_URL`), X API v2 source, urgency scores, health checks.
