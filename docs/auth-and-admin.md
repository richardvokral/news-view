# Auth, access control, admin & infrastructure

## Auth layers (three, from coarse to fine)

1. **Edge middleware** (`src/middleware.ts`) — presence check only. On protected prefixes (`/reports`, `/monitor`, `/news`, `/analyze`, `/insights`, `/admin`, `/api/admin`, `/api/plausible`, `/api/dashboard-layout`, `/api/monitor`, `/no-access`) it checks that the `logto_<LOGTO_APP_ID>` cookie *exists* and redirects to `/api/logto/sign-in` if not. `/api/logto` and `/api/cron` are explicit public exceptions. It does **not** validate the session or check sections — a forged cookie of any value passes it, so **never rely on middleware for authorization**. Every protected route handler and page carries its own check.
2. **Session** (`src/lib/logto.ts`, re-exported via `src/lib/auth.ts`) — `getSession()` returns `{email, isAdmin, sections}`, and requires `ctx.isAuthenticated`. Email from Logto userinfo/claims (lowercased). Fail-closed: any Logto error yields an anonymous session. `getSession({fromClaimsOnly: true})` reads the email from the verified ID-token claims and skips the `/userinfo` HTTP round-trip — same trust level (the cookie is decrypted and verified either way), used on `/api/plausible`, which a dashboard render hits 10+ times. If the session is authenticated but carries no email claim, it retries with `/userinfo` rather than denying, so a tenant that omits the claim degrades to slower, not broken.
3. **ACL** (`src/lib/access.ts`) — `resolveSections(email)` precedence:
   1. `ADMIN_EMAILS` member (env, semicolon-separated, never stored in DB) → all sections + `isAdmin`.
   2. Exact `access_users` row → its sections. **An existing row with an empty array is an explicit deny** — it overrides domain rules.
   3. `access_domains` row for the email's domain.
   4. Otherwise `[]` → `/no-access`.

Sections are `"reports" | "news" | "monitor" | "insights"` (`ALL_SECTIONS` in `src/types/dashboard.ts`). Route handlers/pages must check `session.sections.includes("<feature>")`; admin endpoints check `session.isAdmin`.

The root page `/` redirects: no email → sign-in, then falls through `reports` → `news` → `monitor` → `insights`, else `/no-access`. (A monitor-only user used to land on `/no-access`; the chain now covers every section.)

`/analyze` and `POST /api/analyze` take the **`reports`** grant — they read the same Plausible data through the same key, and the agent loop spends Anthropic tokens.

The Chrome extension uses a separate bearer-token path (see `docs/proofread.md`). Logto is otherwise the only way in; the legacy `SETTINGS_PASSWORD` login at `POST /api/auth` has been removed (nothing read the `settings_auth` cookie it set).

## Database (Neon Postgres)

- Client: `src/lib/db.ts` — `@neondatabase/serverless` Pool over WebSocket; `hasDb()` = `DATABASE_URL` set. Most lib functions no-op gracefully without a DB.
- Migrations: `src/lib/db-migrate.ts` executes `src/lib/db-schema.sql` statement by statement; **all DDL must be idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, seeds `ON CONFLICT DO NOTHING`). Run via `/admin/database` → button, or `POST /api/admin/migrate` (admin, Node runtime).
- Table inventory: `articles` (news ingest) · `access_users`/`access_domains` (ACL) · `dashboard_user_layouts`/`dashboard_defaults` (reports layouts) · `article_monitors`, `article_metric_snapshots`, `article_source_snapshots`, `article_author_snapshots`, `article_titles`, `external_articles`, `coverage_analysis`, `google_trends_snapshots`, `monitor_config` (monitor — see `docs/article-monitor.md`) · `proofread_*` (7 tables — see `docs/proofread.md`) · `insights_*` (7 tables — see `docs/insights.md`). Singletons (`dashboard_defaults`, `monitor_config`, `proofread_settings`, `insights_config`) use `id SMALLINT PK CHECK (id = 1)`.

## Redis

Single ioredis client (`src/lib/redis.ts`), env `STORAGE_REDIS_REDIS_URL` (note the doubled name — it comes from the Vercel Redis integration).

| Key | Purpose |
| --- | --- |
| `config:apis` | Settings blob (API keys, feed toggles, clustering mode) — see below. |
| `articles:all` (zset), `fetch:last`, `fetch:lock` | Article cache / cron mutex. |
| `cache:topics` | Clustered-topics cache, 1h TTL. |
| `monitor:requests:<YYYY-MM-DDTHH>` | Hourly Plausible budget counter. **Shared** by the monitor tick and the insights backfill — the Plausible rate limit is per API key, so a private counter would let a backfill trip a 429 that also kills the monitor. |
| `gnews:requests:<YYYY-MM-DD>` | GNews daily quota counter (cap 90). |
| `ratelimit:extlogin:ip:<ip>` / `ratelimit:extlogin:email:<email>` | Extension-login throttle (10/15 min per IP, 5/h per e-mail). |
| `ratelimit:proofread:<email>` | Proofread cap (60 requests/h per user). |
| `ratelimit:insights:backfill:<email>` / `:site:<site>` | Insights backfill cap (5/h per user, 20/h per site). |
| `ratelimit:insights:analyze:<email>` / `:site:<site>` | Insights analysis cap (10/h per user, 40/h per site). |
| `insights:backfill:lock:<site>` | Backfill mutex. **Fails closed** if Redis is down, unlike the rate limiter. |
| `insights:backfill:cancel:<runKey>` / `insights:backfill:progress:<site>` | Stop button and progress heartbeat. |

**Settings-override convention** (`src/lib/storage/settings.ts`): feature settings = Redis value if set, else env default (`applyEnvDefaults`). Route handlers read `process.env` directly only for secrets/infra (DB, Logto, QStash, Plausible). `/api/settings` masks keys as `****`+last4 and treats masked values as "unchanged" on save.

## Admin surface

`/admin/*` is gated once in `src/app/admin/layout.tsx` (no email → sign-in; not admin → `/no-access`).

| Page | Backing API | Configures |
| --- | --- | --- |
| `/admin/users`, `/admin/domains` | `api/admin/users[/email]`, `api/admin/domains[/domain]` | Per-section ACL grants. |
| `/admin/settings` | `api/settings`, `api/settings/test` | News-API keys, RSS toggles, clustering mode, AI keys (+ live connectivity probes). |
| `/admin/defaults` | `api/admin/dashboard-default` | Shared default reports layout. |
| `/admin/monitor` | `api/admin/monitor-config`, `monitor-run`, `coverage-run` | Monitor knobs + manual tick triggers. |
| `/admin/proofread/*` | `api/admin/proofread/*` | Models, prompts, per-user overrides, Korektor, usage. |
| `/admin/insights` | `api/admin/insights/*` | Backfill knobs, article URL pattern, section vocabulary (with discovery from real slugs), analysis prompts and default model. |
| `/admin/database` | `api/admin/migrate` | Run idempotent migrations. |

Diagnostics: `GET /api/dump` (admin) dumps Redis articles + masked config + quota counters.

## Cron (Upstash QStash + one Vercel cron)

All under `/api/cron/*`, public in middleware, self-authenticated through one shared gate (`src/lib/cron-auth.ts`): `Authorization: Bearer $CRON_SECRET` or `?secret=$CRON_SECRET`, compared in constant time, **failing closed when `CRON_SECRET` is unset**. Prefer the header — the query form leaks the secret into access logs.

| Endpoint | Guard | Does |
| --- | --- | --- |
| `fetch-news` | Redis mutex `fetch:lock` (60s) | Fetch + store + prune articles. Scheduled daily in `vercel.json` (`0 0 * * *`). |
| `article-monitor` | Hourly rate counter | Monitor tick (see `docs/article-monitor.md`). QStash, every ~5 min. |
| `coverage` | ⚠️ none — overlapping triggers can double-run | External RSS ingest + AI coverage analysis. |

The ingestion run itself lives in `src/lib/news-fetch.ts` so the signed-in "Fetch Now" button can call it through `POST /api/news/fetch` (`news` section) without the cron endpoint having to be reachable unauthenticated.

⚠️ **`CRON_SECRET` must be set in Vercel.** It previously wasn't required, and `fetch-news` ran for anyone who asked; now an unset secret means the crons return 401 and ingestion silently stops.

## Env vars

From `.env.example`: `DATABASE_URL`, `STORAGE_REDIS_REDIS_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `WORLDNEWSAPI_KEY`, `NEWSDATAHUB_KEY`, `GNEWS_KEY`, `TWITTER_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`, `LOGTO_BASE_URL`, `ADMIN_EMAILS`, `PLAUSIBLE_API_URL`, `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_IDS`.

Used in code but optional: `PLAUSIBLE_SITE_BASEURLS` (site id → base URL map), `SCRAPE_DO_TOKEN` (Google Trends fallback proxy), `USD_TO_CZK` (proofread cost display, default 23), `EXTENSION_LOGIN_SECRET` (shared enrolment code for the extension — see `docs/proofread.md`).

Secrets live in the Vercel dashboard; adding one means updating `.env.example` *and* setting it in Vercel before the code lands.

## Response headers

`next.config.ts` sets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` denying camera/mic/geolocation, and `X-Robots-Tag: noindex, nofollow` on every response. There is deliberately **no script/style CSP**: the App Router's inline bootstrap needs a per-request nonce, which isn't wired up here.

## Known inconsistencies / gotchas

- The extension login is still e-mail-only unless `EXTENSION_LOGIN_SECRET` is set — see `docs/proofread.md`. Set it.
- The insights backfill spends from the monitor's hourly Plausible counter, so a large backfill and a 5-minute monitor tick compete for the same 600 req/h key budget. See `docs/insights.md`.
- `coverage` cron has no overlap lock.
- The cron gate accepts `?secret=`, which ends up in access logs. Use the `Authorization` header where the scheduler allows it.
- Rate limits (`src/lib/rate-limit.ts`) are fixed-window and **fail open** if Redis is unreachable — deliberate, since Redis is on every hot path, but it means they are a speed bump, not a hard cap.
- `articles` table has no retention job (Redis is pruned to 3 days, Postgres grows).
- ACL is re-read from Postgres on every request (no caching), so revoking a grant takes effect immediately — including for extension bearer tokens.
