# CLAUDE.md

Working notes for Claude Code (and humans skimming the repo). Keep the README short and put long-form context here. Update this file whenever architecture, conventions, or operational details change.

## Project overview

`news-view` is an internal newsroom tool for Echo Media. It ingests articles from news APIs and RSS, clusters them into topics, surfaces editorial reports, and tracks per-article traffic from Plausible. A companion Chrome extension calls the proofread API to AI-edit Czech copy directly in the CMS.

It is a single Next.js 16 (App Router) app deployed to Vercel, with state split across Neon Postgres (durable: articles, ACL, dashboard layouts, monitor snapshots) and Redis (hot path: caches, rate limits, settings overrides).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on `http://localhost:3000`. |
| `npm run build` | Production build. CI uses this. |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint (`eslint-config-next`). |

There is no test runner wired up yet. Lint + a successful `next build` is the bar before pushing.

## Architecture

### Routes (`src/app`)

- `/` — redirects authenticated users into the first section they have access to (`reports` → `news` → `no-access`).
- `/news`, `/reports`, `/analyze`, `/monitor` — feature surfaces.
- `/admin/*` — user & domain ACL, per-feature settings, defaults, monitor config, proofread admin.
- `/no-access` — shown when a signed-in user has no section grants.
- `/api/*` — server actions / route handlers. Subtree mirrors features (`api/monitor`, `api/proofread`, `api/admin`, `api/cron`, etc.). `api/logto/*` and `api/cron/*` are intentionally public; everything else under a protected prefix requires a Logto session (see middleware).
- `/api/extension/*` — bearer-token auth for the Chrome extension (no Logto cookie).

### Server libs (`src/lib`)

- `auth.ts` / `logto.ts` — Logto helpers and `getSession()` returning `{ email, sections, ... }`.
- `access.ts` — ACL: admin-email bypass + DB-backed user/domain grants per feature section.
- `db.ts`, `db-migrate.ts`, `db-schema.sql` — Neon serverless Postgres client + idempotent migrator triggered via `/api/admin/migrate`.
- `redis.ts` — single ioredis client; used for settings overrides, rate caps, cron locks.
- `fetchers/` — pluggable news sources (`world-news-api`, `gnews`, `newsdatahub`, `twitter`, `rss`) behind a shared `types.ts` contract.
- `clustering/` — topic clustering. Two strategies: keyword (`keyword-clustering.ts`) and AI (`ai-clustering.ts` for Anthropic, `openai-clustering.ts` for OpenAI), composed in `hybrid-clustering.ts`. `tokenizer.ts` is shared.
- `monitor/` — Plausible-driven article monitor pipeline (`pipeline.ts`), config (`config.ts`), Postgres queries (`queries.ts`), Google Trends / RSS helpers.
- `proofread/` — router that picks between Anthropic and OpenAI (`router.ts`), prompt templates (`prompts.ts`, Czech), diff parsing (`parse.ts`), usage accounting (`usage.ts`), bearer auth for the extension (`auth.ts`).
- `analyze/` — Anthropic tool-use prompts for editorial analysis.
- `dashboard/` — default layout + queries for the reports/news dashboards.
- `storage/articles.ts`, `storage/settings.ts` — DB + Redis accessors used by everything above.
- `plausible.ts`, `plausible-validate.ts` — Plausible API wrappers used by both reports and the monitor.

### Middleware (`src/middleware.ts`)

Gate-only: checks for a `logto_<APP_ID>` cookie on protected prefixes (`/reports`, `/monitor`, `/admin`, `/api/admin`, `/api/plausible`, `/api/dashboard-layout`, `/api/monitor`, `/no-access`) and redirects to `/api/logto/sign-in` if missing. Fine-grained ACL (per-section, per-domain) happens in route handlers via `src/lib/access.ts` — do not rely on middleware for authorization.

### Chrome extension (`extension/`)

MV3 extension loaded unpacked. Communicates with this app over HTTPS using a bearer token issued by `/api/extension/login`. See `extension/README.md` for the workflow. The folder is excluded from Vercel deploys via `.vercelignore`.

## Data & external services

- **Neon Postgres** (`DATABASE_URL`) — articles, monitors, ACL, dashboard layouts. Schema: `src/lib/db-schema.sql`. Migrate via `POST /api/admin/migrate` as an admin.
- **Redis** (`STORAGE_REDIS_REDIS_URL`) — caches, settings overrides, rate limits, cron locks.
- **Logto** (`LOGTO_*`) — OIDC. `ADMIN_EMAILS` (semicolon-separated) bypasses DB ACL and is never persisted.
- **Upstash QStash** (`QSTASH_*`) — schedules `/api/cron/*` endpoints (article monitor, ingestion). Endpoints validate `Authorization: Bearer $CRON_SECRET`.
- **Plausible** (`PLAUSIBLE_API_URL`, `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_IDS`) — pageview source.
- **News APIs** (`WORLDNEWSAPI_KEY`, `NEWSDATAHUB_KEY`, `GNEWS_KEY`, `TWITTER_BEARER_TOKEN`) — optional, configurable at runtime via `/admin/settings`.
- **AI** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — clustering, analyze, proofread. Either provider is fine; the proofread router picks based on settings.

## Conventions

- TypeScript everywhere; path alias `@/*` → `src/*`.
- Server-only code lives in `src/lib`; never import it from a `"use client"` component.
- Feature-scoped UI lives in `src/components/<feature>/`; shared chrome (e.g. `TopNav`) at the top level.
- API routes return JSON with a stable shape; errors as `{ error: string }` with a sensible HTTP status. Cron endpoints return `{ skippedReason?: string, ... }` (see `docs/article-monitor.md`).
- Auth: call `getSession()` from `src/lib/auth.ts`; check `session.sections.includes("<feature>")` before serving feature data. Admin-only endpoints additionally check `ADMIN_EMAILS`.
- Settings: read via `src/lib/storage/settings.ts` so env-var defaults and Redis overrides stay in one place. Don't read `process.env` directly from route handlers for feature settings — only for secrets/infra (DB URL, Logto, QStash).
- Tailwind v4 via `@tailwindcss/postcss`. Keep styles in JSX; no per-file `.module.css` unless you have a specific reason.

## Operational notes

- **First boot**: sign in as an `ADMIN_EMAILS` user, then `POST /api/admin/migrate` to create tables.
- **Cron**: configured in Upstash QStash, hitting `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`. See `docs/article-monitor.md` for the article monitor runbook.
- **Vercel**: project deploys from `main`. `.vercelignore` excludes the `extension/` folder. `vercel.json` is intentionally minimal.
- **Local Plausible**: not required — the monitor will simply record 0s if the Plausible call fails; other features run independently.

## Where to look first

- Adding a news source → `src/lib/fetchers/` + register in `index.ts`.
- Changing clustering behavior → `src/lib/clustering/hybrid-clustering.ts` is the entry point.
- Changing what shows on `/monitor` → `src/lib/monitor/pipeline.ts` and `src/app/monitor/page.tsx`; runbook in `docs/article-monitor.md`.
- Proofread prompt or model tweaks → `src/lib/proofread/prompts.ts` and `router.ts`.
- New protected route → add the prefix to `PROTECTED_PREFIXES` **and** the `matcher` in `src/middleware.ts`, then enforce section ACL inside the handler.
- New DB table → append to `src/lib/db-schema.sql` (statements must be idempotent) and re-run `/api/admin/migrate`.

## Gotchas

- `next build` will fail if `LOGTO_*` env vars are missing at build time only for routes that statically import them at module scope — keep Logto access inside request handlers, not top-level module code.
- Plausible visitors are cumulative-since-midnight; the monitor sparkline therefore "drops" at the day boundary by design.
- The Chrome extension defaults its backend to `https://news-view.vercel.app`. For local testing, point it to `http://localhost:3000` in **Nastavení serveru**.
- `ADMIN_EMAILS` is read fresh on every request; rotating it does not require a redeploy if you change it in Vercel env, but a redeploy is still needed for it to apply (env is baked at build for non-edge).

## Updating this file

Put any non-trivial architectural change, new external integration, new env var, new feature surface, or operational gotcha here. README stays short and user-facing; CLAUDE.md is the living context doc.
