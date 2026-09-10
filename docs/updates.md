# Updates

Reverse-chronological log of notable changes. One entry per meaningful shipment, not per commit — see `git log` for the full history. Add a new entry (top of the list) whenever you land a user-visible feature, a new integration, a schema change, or an operational change.

## 2026-09

- **`/insights` gains headline analysis, saved playbooks and a title rewriter.** Three connected tabs closing the loop from measurement to the headline an editor is about to publish.
  - **Titulky** contrasts four cohorts side by side: normalised winners/losers (an article against the median of its own section in the week it debuted — where the title's contribution shows) and raw winners/losers (which mostly surface popular topics). Scoring is a log-ratio over a fixed exposure window, so a top-vs-bottom read isn't skewed by construction. Truncated weeks are excluded outright: they are missing their long tail, so including one would silently turn "bottom" into the middle of the distribution.
  - The analysis also emits an editable Czech **playbook** — rules written as instructions, not as a report — saved per site with a shared fallback and provenance back to the run that produced it.
  - **Přepsat titulek** takes a proposed headline (plus optional section and perex) and returns a critique and variants, each citing playbook rules by id so the server can validate every citation. Since nothing here is verifiable against stored rows, the guarantee is layered: contract last with a closing override naming the poisoned instructions, the playbook carried as tagged *data* in the user message rather than as instruction, and server checks that flag numbers in prose, performance phrasing, and any digit in a variant that isn't in the original.
  - **og:title enrichment** (admin-only) fetches real headlines from the site's own pages, since stored titles are mostly de-slugified from URLs and therefore have no diacritics or punctuation. Reads only to `</head>`, compares the short id on redirect so a homepage bounce can't poison the corpus with a section title, parses paywalled pages anyway, and never overwrites an RSS title.
  - Prompts are Czech throughout, matching proofread and the existing insights prompts.

- **`/insights` — most-read articles and AI theme analysis.** A fourth top-level surface answering "what did people actually read over the last six months, and what were the themes?", built as two independent halves.
  - **Loading:** a manual, chunked backfill pulls per-article Plausible stats in weekly buckets into Postgres (`insights_pages`, `insights_page_weeks`), so repeated analysis costs no API calls. The first run covers ~6 months; later runs fetch only the weeks missing from the ledger. Each request handles a few weeks and reports what remains, so it stays inside the serverless limit and a dropped response just resumes. A week commits all-or-nothing and the first failure stops the run — no hammering — while everything already fetched is kept. Redis lock, Stop button, and a metric ladder that steps down when Plausible rejects session metrics on a page breakdown.
  - **Parsing:** `/a/<shortId>/<slug>` yields sections and a headline. At most two leading slug tokens count as sections, and only ones in an admin-managed vocabulary — otherwise headline words get mistaken for rubrics. `/admin/insights` discovers candidates from real slugs rather than guessing a taxonomy.
  - **Analysis:** a separate step where the model returns *only* prose and article indexes; the server recomputes every count, sum, share and headline-pattern lift from the rows, and reconciles assigned + unassigned against the total. Prompts are DB-editable, but the output contract is appended in code and can't be edited away. Model comes from the shared catalog; runs are stored with scope, tokens and cost, and are re-runnable.
  - Nothing is pruned — scope is chosen per analysis instead. Note this is a deliberate exception to the "retention is days, not years" line in the vision doc, which now says so.
  - Also fixed in passing: the root redirect now covers every section, so a monitor-only user no longer lands on `/no-access`.

- **Security review pass.** Closed the authorization gaps a route-by-route audit turned up, and brought dependencies back to zero known advisories.
  - `GET /api/plausible` now verifies the session and the `reports` grant itself. It previously trusted the edge middleware, which only checks that a `logto_<APP_ID>` cookie *exists* — any forged value reached the Plausible proxy. A new `getSession({fromClaimsOnly: true})` keeps that hot path cheap by skipping the `/userinfo` round-trip.
  - `/api/cron/*` share one gate (`src/lib/cron-auth.ts`): constant-time secret compare, **failing closed** when `CRON_SECRET` is unset. `fetch-news` used to be wide open in that case *and* accepted the mere presence of an `upstash-signature` header. The `/news` "Fetch Now" button moved to `POST /api/news/fetch` (session + `news`), so the cron endpoint no longer has to be publicly reachable. **`CRON_SECRET` must now be set in Vercel or ingestion stops.**
  - `GET /api/topics` and `GET /api/stats` require the `news` grant (both were unauthenticated); `?refresh=1`, which forces a paid re-cluster, is admin-only. `/analyze` and `/api/analyze` require `reports` instead of just a login.
  - Extension login is rate-limited (per IP and per e-mail) and accepts an optional shared enrolment code via `EXTENSION_LOGIN_SECRET`; `/api/proofread` is capped at 60 requests/h per user and 200 000 input characters. **Set `EXTENSION_LOGIN_SECRET`** — without it, knowing a granted e-mail address is still enough to mint a 30-day token.
  - Removed `POST /api/auth`, a legacy unauthenticated password endpoint whose `settings_auth` cookie nothing read.
  - Security response headers (HSTS, nosniff, frame-ancestors, referrer, permissions, noindex) in `next.config.ts`.
  - Next.js 16.1.6 → 16.3.4, clearing ~28 advisories including several App Router **middleware/proxy bypasses**, plus `ws` and dev-tooling bumps. `npm audit` is clean.

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
