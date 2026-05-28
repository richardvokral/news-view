# news-view

Internal newsroom dashboard for monitoring article performance, clustering topics, and proofreading copy. Built on Next.js (App Router) and deployed to Vercel.

## Features

- **News & Reports** — clustered topic views and editorial reports backed by news APIs and RSS.
- **Article Monitor** — near-real-time per-article pageviews pulled from Plausible (see [`docs/article-monitor.md`](docs/article-monitor.md)).
- **Analyze** — AI-assisted analysis of article performance and titles.
- **Proofread API + Chrome extension** — Czech-language proofreading inside the CMS editor (see [`extension/README.md`](extension/README.md)).
- **Admin** — user/domain ACL, per-feature settings, manual cron triggers.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the values you need
npm run dev                  # http://localhost:3000
```

`npm run build` produces a production build; `npm run lint` runs ESLint.

## Configuration

All secrets live in env vars; see [`.env.example`](.env.example) for the full list. Minimum to boot locally:

- `DATABASE_URL` — Neon Postgres
- `STORAGE_REDIS_REDIS_URL` — Redis (Vercel Redis or local)
- `LOGTO_*` — OIDC auth (Logto)
- `ADMIN_EMAILS` — semicolon-separated admin allowlist

News-API and AI keys are optional per feature and can also be set at `/admin/settings`. After first boot, sign in as an admin and POST `/api/admin/migrate` to create DB tables.

## Tech stack

Next.js 16 / React 19 · TypeScript · Tailwind v4 · Neon Postgres · Redis · Upstash QStash (cron) · Logto (auth) · Plausible · Anthropic + OpenAI SDKs.

## Project layout

```
src/app/         routes (news, reports, analyze, monitor, admin, api/*)
src/components/  feature-scoped React components
src/lib/         server logic: fetchers, clustering, storage, auth, monitor, proofread
src/middleware.ts  Logto session gate for protected routes
extension/       Chrome MV3 proofreading extension (loaded unpacked)
docs/            feature runbooks
```

More detail and conventions for contributors live in [`CLAUDE.md`](CLAUDE.md).
