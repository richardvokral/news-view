# Auth, access control, admin & infrastructure

## Auth layers (three, from coarse to fine)

1. **Edge middleware** (`src/middleware.ts`) — presence check only. On protected prefixes (`/reports`, `/monitor`, `/admin`, `/api/admin`, `/api/plausible`, `/api/dashboard-layout`, `/api/monitor`, `/no-access`) it checks that the `logto_<LOGTO_APP_ID>` cookie *exists* and redirects to `/api/logto/sign-in` if not. `/api/logto` and `/api/cron` are explicit public exceptions. It does **not** validate the session or check sections — never rely on middleware for authorization.
2. **Session** (`src/lib/logto.ts`, re-exported via `src/lib/auth.ts`) — `getSession()` returns `{email, isAdmin, sections}`. Email from Logto userinfo/claims (lowercased). Fail-closed: any Logto error yields an anonymous session.
3. **ACL** (`src/lib/access.ts`) — `resolveSections(email)` precedence:
   1. `ADMIN_EMAILS` member (env, semicolon-separated, never stored in DB) → all sections + `isAdmin`.
   2. Exact `access_users` row → its sections. **An existing row with an empty array is an explicit deny** — it overrides domain rules.
   3. `access_domains` row for the email's domain.
   4. Otherwise `[]` → `/no-access`.

Sections are `"reports" | "news" | "monitor"` (`ALL_SECTIONS` in `src/types/dashboard.ts`). Route handlers/pages must check `session.sections.includes("<feature>")`; admin endpoints check `session.isAdmin`.

The root page `/` redirects: no email → sign-in; `reports` → `/reports`; else `news` → `/news`; else `/no-access`. ⚠️ A monitor-only user lands on `/no-access` from the root but can navigate to `/monitor` directly.

The Chrome extension uses a separate bearer-token path (see `docs/proofread.md`), and there's a legacy password login at `POST /api/auth` (`SETTINGS_PASSWORD`, timing-safe, IP lockout via `auth:fail:<ip>`/`auth:lock:<ip>`) that is being phased out.

## Database (Neon Postgres)

- Client: `src/lib/db.ts` — `@neondatabase/serverless` Pool over WebSocket; `hasDb()` = `DATABASE_URL` set. Most lib functions no-op gracefully without a DB.
- Migrations: `src/lib/db-migrate.ts` executes `src/lib/db-schema.sql` statement by statement; **all DDL must be idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, seeds `ON CONFLICT DO NOTHING`). Run via `/admin/database` → button, or `POST /api/admin/migrate` (admin, Node runtime).
- Table inventory: `articles` (news ingest) · `access_users`/`access_domains` (ACL) · `dashboard_user_layouts`/`dashboard_defaults` (reports layouts) · `article_monitors`, `article_metric_snapshots`, `article_source_snapshots`, `article_author_snapshots`, `article_titles`, `external_articles`, `coverage_analysis`, `google_trends_snapshots`, `monitor_config` (monitor — see `docs/article-monitor.md`) · `proofread_*` (7 tables — see `docs/proofread.md`). Singletons (`dashboard_defaults`, `monitor_config`, `proofread_settings`) use `id SMALLINT PK CHECK (id = 1)`.

## Redis

Single ioredis client (`src/lib/redis.ts`), env `STORAGE_REDIS_REDIS_URL` (note the doubled name — it comes from the Vercel Redis integration).

| Key | Purpose |
| --- | --- |
| `config:apis` | Settings blob (API keys, feed toggles, clustering mode) — see below. |
| `articles:all` (zset), `fetch:last`, `fetch:lock` | Article cache / cron mutex. |
| `cache:topics` | Clustered-topics cache, 1h TTL. |
| `monitor:requests:<YYYY-MM-DDTHH>` | Monitor's hourly Plausible budget counter. |
| `gnews:requests:<YYYY-MM-DD>` | GNews daily quota counter (cap 90). |
| `auth:fail:<ip>` / `auth:lock:<ip>` | Legacy login brute-force guard (15 min). |

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
| `/admin/database` | `api/admin/migrate` | Run idempotent migrations. |

Diagnostics: `GET /api/dump` (admin) dumps Redis articles + masked config + quota counters.

## Cron (Upstash QStash + one Vercel cron)

All under `/api/cron/*`, public in middleware, self-authenticated:

| Endpoint | Auth | Guard | Does |
| --- | --- | --- | --- |
| `fetch-news` | Bearer `CRON_SECRET` **or** `upstash-signature` header presence; **open if secret unset** | Redis mutex `fetch:lock` (60s) | Fetch + store + prune articles. Scheduled daily in `vercel.json` (`0 0 * * *`). |
| `article-monitor` | Bearer or `?secret=`; rejects all if secret unset | Hourly rate counter | Monitor tick (see `docs/article-monitor.md`). QStash, every ~5 min. |
| `coverage` | same | ⚠️ none — overlapping triggers can double-run | External RSS ingest + AI coverage analysis. |

## Env vars

From `.env.example`: `DATABASE_URL`, `STORAGE_REDIS_REDIS_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `WORLDNEWSAPI_KEY`, `NEWSDATAHUB_KEY`, `GNEWS_KEY`, `TWITTER_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`, `LOGTO_BASE_URL`, `ADMIN_EMAILS`, `PLAUSIBLE_API_URL`, `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_IDS`.

Used in code but optional: `PLAUSIBLE_SITE_BASEURLS` (site id → base URL map), `SCRAPE_DO_TOKEN` (Google Trends fallback proxy), `USD_TO_CZK` (proofread cost display, default 23), `SETTINGS_PASSWORD` (legacy login, being phased out).

Secrets live in the Vercel dashboard; adding one means updating `.env.example` *and* setting it in Vercel before the code lands.

## Known inconsistencies / gotchas

- `fetch-news` fails open without `CRON_SECRET`; the other two crons fail closed.
- The `upstash-signature` header on `fetch-news` is checked for presence only, not verified against the QStash signing keys.
- `coverage` cron has no overlap lock.
- The `/news` "Fetch Now" button calls `fetch-news` without credentials — it only works because `/api/cron` is a middleware exception and (currently) the secret check passes; revisit if `CRON_SECRET` handling changes.
- `articles` table has no retention job (Redis is pruned to 3 days, Postgres grows).
