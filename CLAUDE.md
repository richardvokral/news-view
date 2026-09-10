# CLAUDE.md

Working notes for Claude Code (and humans skimming the repo). Keep the README short and put long-form context here. Update this file whenever architecture, conventions, or operational details change.

## Documentation map

Long-form docs live in `docs/`; this file stays the working-notes index. When you change a subsystem, update its doc; when you ship something notable, add an entry to `docs/updates.md`.

- `docs/architecture.md` — system overview, layering rules, docs map.
- `docs/vision.md` — product vision and roadmap priorities.
- `docs/updates.md` — human-readable changelog (newest first; one entry per shipment, not per commit).
- `docs/article-monitor.md` — monitor pipeline internals + runbook.
- `docs/news-pipeline.md` — fetchers, clustering, /news, /reports, /analyze.
- `docs/proofread.md` — proofread backend + Chrome extension.
- `docs/auth-and-admin.md` — auth/ACL, DB/Redis, cron, env vars.
- `docs/insights.md` — weekly Plausible backfill, theme analysis, headline analysis + rewriter (`/insights`).
- `docs/plans/` — product design docs; `article-insights-providers.md` is the active one (analytics-provider abstraction for the monitor).

## Project overview

`news-view` is an internal newsroom tool for Echo Media. It ingests articles from news APIs and RSS, clusters them into topics, surfaces editorial reports, and tracks per-article traffic from Plausible. A companion Chrome extension calls the proofread API to AI-edit Czech copy directly in the CMS.

It is a single Next.js 16 (App Router) app deployed to Vercel, with state split across Neon Postgres (durable: articles, ACL, dashboard layouts, monitor snapshots) and Redis (hot path: caches, rate limits, settings overrides).

## Workflow

The owner (Richard) drives this repo through Claude Code — either the desktop app or the web UI at `claude.ai/code`. There is no separate local checkout / PR review step in the normal loop:

1. Open a task in Claude Code (app or web).
2. Claude makes changes on a working branch and commits.
3. Commits are pushed straight to the **default branch** on GitHub (currently `claude/news-aggregator-tool-HvXDC`, not `main`).
4. Vercel is wired to the default branch and **auto-deploys on every push** — production reflects whatever just landed.

Implications when you (Claude) are working here:

- Treat every push to the default branch as a production deploy. There is no staging environment in front of it.
- Before pushing, make sure `npm run build` and `npm run lint` would pass — a broken build means a broken production deploy.
- Never force-push the default branch, and never rewrite its history. Add new commits instead.
- The "feature branch" the task instructions point you at is a working branch; the final landing point is the default branch. If the user says "push to default" or "ship it", fast-forward the default branch from the working branch (don't merge-commit) so history stays linear.
- Don't open PRs unless explicitly asked — the workflow does not use them.
- Secrets / env changes are managed in the Vercel dashboard, not in the repo. Adding a new env var means: document it in `.env.example` *and* tell the user to set it in Vercel before merging the code that needs it.

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

- `/` — redirects authenticated users into the first section they have access to (`reports` → `news` → `monitor` → `insights` → `no-access`).
- `/news`, `/reports`, `/analyze`, `/monitor`, `/insights` — feature surfaces. `/analyze` takes the `reports` grant (same Plausible data, same API key). `/insights` has its own grant.
- `/admin/*` — user & domain ACL, per-feature settings, defaults, monitor config, proofread admin, insights config.
- `/no-access` — shown when a signed-in user has no section grants.
- `/api/*` — server actions / route handlers. Subtree mirrors features (`api/monitor`, `api/proofread`, `api/admin`, `api/cron`, etc.). `api/logto/*` is public; `api/cron/*` is cookie-exempt but authenticates with `CRON_SECRET` (fails closed). **Every other handler does its own `getSession()` + section check** — middleware is not authorization.
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
- `insights/` — long-horizon article stats: chunked weekly Plausible backfill (`backfill.ts`), URL/section parsing (`paths.ts`), ISO-week maths (`weeks.ts`), Postgres access (`store.ts`), and the AI theme analysis (`analyze.ts` + `providers.ts` + `ground.ts`, which recomputes every number the model might otherwise invent).
  - Headline work sits alongside it: `titleAnalysis.ts` (cohort SQL), `titleRun.ts` (analysis + rewriter orchestration), `titlePrompts.ts` / `titleProviders.ts` (Czech contracts and schemas), `titleFetch.ts` (og:title enrichment). Saved playbooks live in `insights_prompts` with `kind='title_rewrite'`.
- `ai/models.ts` — shared AI model catalog reader. Physically `proofread_models`; treat that table name as history, not ownership.
- `dashboard/` — default layout + queries for the reports/news dashboards.
- `storage/articles.ts`, `storage/settings.ts` — DB + Redis accessors used by everything above.
- `plausible.ts`, `plausible-validate.ts` — Plausible API wrappers used by reports, the monitor and the insights backfill. `getBreakdownPaged` is the paginating variant for internal callers; the user-facing `MAX_LIMIT` of 100 deliberately stays put.

### Middleware (`src/middleware.ts`)

Gate-only: checks that a `logto_<APP_ID>` cookie *exists* on protected prefixes (`/reports`, `/monitor`, `/news`, `/analyze`, `/insights`, `/admin`, `/api/admin`, `/api/plausible`, `/api/dashboard-layout`, `/api/monitor`, `/no-access`) and redirects to `/api/logto/sign-in` if missing. It never validates the cookie, so a forged one passes — it is a redirect convenience for pages, nothing more. Fine-grained ACL (per-section, per-domain) happens in route handlers via `src/lib/access.ts`; **do not rely on middleware for authorization**, and note that Next has shipped several middleware-bypass advisories, so a route whose only gate is middleware is a route with no gate.

### Chrome extension (`extension/`)

MV3 extension loaded unpacked. Communicates with this app over HTTPS using a bearer token issued by `/api/extension/login`. See `extension/README.md` for the workflow. The folder is excluded from Vercel deploys via `.vercelignore`.

## Data & external services

- **Neon Postgres** (`DATABASE_URL`) — articles, monitors, ACL, dashboard layouts. Schema: `src/lib/db-schema.sql`. Migrate via `POST /api/admin/migrate` as an admin.
- **Redis** (`STORAGE_REDIS_REDIS_URL`) — caches, settings overrides, rate limits, cron locks.
- **Logto** (`LOGTO_*`) — OIDC. `ADMIN_EMAILS` (semicolon-separated) bypasses DB ACL and is never persisted.
- **Upstash QStash** (`QSTASH_*`) — schedules `/api/cron/*` endpoints (article monitor, ingestion). Endpoints validate `Authorization: Bearer $CRON_SECRET` (or `?secret=`, which leaks into access logs) through `src/lib/cron-auth.ts` and **reject everything when `CRON_SECRET` is unset** — so it must be set in Vercel or ingestion and the monitor silently stop.
- **Plausible** (`PLAUSIBLE_API_URL`, `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_IDS`) — pageview source.
- **News APIs** (`WORLDNEWSAPI_KEY`, `NEWSDATAHUB_KEY`, `GNEWS_KEY`, `TWITTER_BEARER_TOKEN`) — optional, configurable at runtime via `/admin/settings`.
- **AI** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — clustering, analyze, proofread. Either provider is fine; the proofread router picks based on settings.
- **Extension enrolment** (`EXTENSION_LOGIN_SECRET`, optional) — shared code required by `/api/extension/login` when set. Leave it unset and the endpoint is e-mail-only: knowing a granted address is enough to mint a 30-day token to the paid proofread API. Set it.

## Conventions

- TypeScript everywhere; path alias `@/*` → `src/*`.
- Server-only code lives in `src/lib`; never import it from a `"use client"` component.
- Feature-scoped UI lives in `src/components/<feature>/`; shared chrome (e.g. `TopNav`) at the top level.
- API routes return JSON with a stable shape; errors as `{ error: string }` with a sensible HTTP status. Cron endpoints return `{ skippedReason?: string, ... }` (see `docs/article-monitor.md`).
- Auth: call `getSession()` from `src/lib/auth.ts`; check `session.sections.includes("<feature>")` before serving feature data. Admin-only endpoints additionally check `ADMIN_EMAILS`. On a route hit many times per render, `getSession({fromClaimsOnly: true})` skips the Logto `/userinfo` call without weakening the check.
- Anything that spends money on someone else's behalf (LLM calls, paid news APIs, Plausible quota) needs both an ACL check and a limit: `src/lib/rate-limit.ts` for per-user/per-IP caps, an input-size ceiling for LLM payloads, admin-only for "force a re-run" switches.
- Response headers (HSTS, nosniff, frame-ancestors, referrer, permissions, noindex) live in `next.config.ts`. There's no script CSP — the App Router's inline bootstrap would need per-request nonces.
- Settings: read via `src/lib/storage/settings.ts` so env-var defaults and Redis overrides stay in one place. Don't read `process.env` directly from route handlers for feature settings — only for secrets/infra (DB URL, Logto, QStash).
- Tailwind v4 via `@tailwindcss/postcss`. Keep styles in JSX; no per-file `.module.css` unless you have a specific reason.

## Operational notes

- **First boot**: sign in as an `ADMIN_EMAILS` user, then `POST /api/admin/migrate` to create tables.
- **Cron**: configured in Upstash QStash, hitting `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`. See `docs/article-monitor.md` for the article monitor runbook.
- **Vercel**: project auto-deploys from the default branch (currently `claude/news-aggregator-tool-HvXDC` — see Workflow above), not `main`. `.vercelignore` excludes the `extension/` folder. `vercel.json` is intentionally minimal.
- **Local Plausible**: not required — the monitor will simply record 0s if the Plausible call fails; other features run independently.

## Where to look first

- Adding a news source → `src/lib/fetchers/` + register in `index.ts`.
- Changing what `/insights` loads or analyses → `src/lib/insights/`; runbook in `docs/insights.md`.
- Changing clustering behavior → `src/lib/clustering/hybrid-clustering.ts` is the entry point.
- Changing what shows on `/monitor` → `src/lib/monitor/pipeline.ts` and `src/app/monitor/page.tsx`; runbook in `docs/article-monitor.md`.
- Proofread prompt or model tweaks → `src/lib/proofread/prompts.ts` and `router.ts`.
- New protected route → enforce section ACL inside the handler first (that's the actual gate); for a *page*, also add the prefix to `PROTECTED_PREFIXES` **and** the `matcher` in `src/middleware.ts` so signed-out users get redirected instead of a broken render.
- New DB table → append to `src/lib/db-schema.sql` (statements must be idempotent) and re-run `/api/admin/migrate`.
- Rate limiting / client IP → `src/lib/rate-limit.ts`. Cron auth → `src/lib/cron-auth.ts`.

## Gotchas

- `next build` will fail if `LOGTO_*` env vars are missing at build time only for routes that statically import them at module scope — keep Logto access inside request handlers, not top-level module code.
- Plausible visitors are cumulative-since-midnight; the monitor sparkline therefore "drops" at the day boundary by design.
- The Chrome extension defaults its backend to `https://news-view.vercel.app`. For local testing, point it to `http://localhost:3000` in **Nastavení serveru**.
- `ADMIN_EMAILS` is read fresh on every request; rotating it does not require a redeploy if you change it in Vercel env, but a redeploy is still needed for it to apply (env is baked at build for non-edge).
- Rate limits fail **open** when Redis is unreachable (by design — Redis is on every hot path), so they're a speed bump, not a hard cap.
- `maxDuration` in a route file must be a **literal** — Next rejects an imported constant with "Invalid segment configuration export". `/api/insights/backfill` hardcodes 300 next to a comment pointing at `BACKFILL_MAX_DURATION_S`.
- The migrator's SQL splitter breaks on a line-ending `;` or a `--` inside a string literal, so Czech prompt bodies are seeded from TypeScript (`ensureDefaultPrompts()`), not from `db-schema.sql`. Do the same for any new prose seed.
- Summing weekly Plausible `visitors` overcounts uniques; only `pageviews` sums cleanly. `bounce_rate`/`visit_duration` are session metrics and must be averaged weighted by `visits`.
- **Never feed a `truncated` week into a bottom-performer analysis.** A truncated week hit the page cap, so its long tail — the low performers — is absent rather than zero, and "bottom" silently becomes the middle of the distribution. `listTitleCohorts` joins `insights_backfill_weeks` for exactly this reason.
- Stored headlines are mostly de-slugified from URLs, so they have no diacritics or punctuation. Anything reasoning about headline *form* must report the slug-derived share; `/admin/insights` can fetch real og:titles.
- `eslint-config-next` 16.3 enabled the React Compiler rules. The reports widgets fetch inside effects and trip `react-hooks/set-state-in-effect`; those files are demoted to warnings in `eslint.config.mjs` so the lint gate still bites for new code. The widgets want a real data-fetching refactor.

## Updating this file

Put any non-trivial architectural change, new external integration, new env var, new feature surface, or operational gotcha here. README stays short and user-facing; CLAUDE.md is the living context doc.
