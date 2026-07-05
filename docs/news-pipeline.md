# News pipeline: ingestion, clustering, dashboards, analyze

How external news gets in, becomes topics on `/news`, and how the Plausible-backed `/reports` and `/analyze` surfaces work.

## Ingestion (`src/lib/fetchers/`)

All fetchers implement the shared contract in `src/lib/fetchers/types.ts`:

```ts
interface Fetcher { name: string; fetch(country: "us" | "de", since?: string | null): Promise<NormalizedArticle[]>; }
```

`NormalizedArticle` = `{ id, title, summary, url, imageUrl, publishedAt, source, sourceCountry, category, keywords }`, where `id = hashId(url)` (first 16 hex chars of SHA-256, `utils.ts`).

| Fetcher | API | Auth | Notes |
| --- | --- | --- | --- |
| `world-news-api.ts` | `worldnewsapi.com/top-news` | `api-key` query param | Own fuzzy title dedup (word-overlap Jaccard ≥ 0.7). |
| `gnews.ts` | `gnews.io/api/v4/top-headlines` | `apikey` query param | Redis daily cap **90 requests/day** (`gnews:requests:<date>`), returns `[]` over cap. |
| `newsdatahub.ts` | `api.newsdatahub.com/v1/news` | `X-API-Key` header | |
| `twitter.ts` | `api.x.com/2/tweets/search/recent` | Bearer token | Breaking-news search queries per country; summary = engagement count. |
| `rss.ts` | 5 hardcoded feeds (Guardian, DW, Spiegel, Fox, Reuters) | none | Regex XML parsing, 30 items/feed cap, ignores `since`. |

Composition (`index.ts`): `getEnabledFetchers(config)` includes a fetcher only when enabled **and** it has a key (from Redis settings with env fallback — see below). `fetchAllNews` runs every fetcher × {us, de} with `Promise.allSettled`, dedups by article id (first wins), then **recomputes `keywords` from the title** via `extractKeywords` — fetcher-supplied keywords are discarded.

Adding a source: create `src/lib/fetchers/<name>.ts` implementing `Fetcher`, register it in `index.ts`, add its config to `ApiConfig` in `types.ts` + the `/admin/settings` form.

## Clustering (`src/lib/clustering/`)

Strategy is chosen by `getClusteringStrategy(config)` from `clustering.mode` (a runtime setting): `keywords` | `ai` (Anthropic) | `ai-openai` | `hybrid` | `hybrid-openai`. Missing API key always falls back to keyword clustering.

- **Keyword** (`keyword-clustering.ts`): union-find over articles, joining pairs with keyword Jaccard ≥ 0.25 (O(n²)); `tokenizer.ts` provides stop-word filtering (EN+DE+news filler) and naive stemming.
- **AI** (`ai-clustering.ts` Anthropic `claude-haiku-4-5`, `openai-clustering.ts` `gpt-4o-mini`): sends compact article JSON, expects a JSON array of `{name, category, urgency 1–5, articleIds}` (`ai-shared.ts` builds the prompt). Anthropic path batches at 50 articles and merges. **Any error falls back to keyword clustering.**
- **Hybrid** (`hybrid-clustering.ts`, the usual entry point): keyword-cluster first, then one AI call refines names/categories/urgency and merges clusters (`mergeWith`). On error, returns the raw keyword topics.

Every strategy produces `Topic` rows with `countByCountry`, `trendScore` (share of last-2h articles among last-24h), `urgency` (heuristic in `computeUrgency`, AI can override), sorted urgency → trend → size.

## Storage (`src/lib/storage/`)

- **`articles.ts`** — dual-write: Postgres `articles` table (`INSERT … ON CONFLICT (url) DO NOTHING`) *and* Redis sorted set `articles:all` (score = publishedAt ms). Reads prefer Postgres when `DATABASE_URL` is set, else Redis. `fetch:last` records the last fetch; `fetch:lock` (`SET NX EX 60`) is the cron mutex. ⚠️ `pruneOldArticles` prunes **Redis only** (3 days) — the `articles` table has no retention job and grows unbounded.
- **`settings.ts`** — the settings-override pattern used app-wide: `getApiConfig()` reads the `config:apis` JSON blob from Redis and overlays env-var defaults (`WORLDNEWSAPI_KEY`, `NEWSDATAHUB_KEY`, `GNEWS_KEY`, `TWITTER_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) for any key the blob leaves empty. Edited at `/admin/settings` (masked `****`+last4; masked values are kept unchanged on save).

## API routes

| Route | Auth | Behavior |
| --- | --- | --- |
| `GET /api/cron/fetch-news` | Bearer `CRON_SECRET` *or* an `upstash-signature` header (presence only, not verified); **open if `CRON_SECRET` unset** | Lock → fetch all → store → prune Redis. Returns `{success, fetched, stored, duplicates, pruned}`. Scheduled daily by `vercel.json`; also hit by the `/news` "Fetch Now" button. |
| `GET /api/topics` | none in-route (page gated by `news` section) | Clusters articles from the last `days` (default 3). Redis cache `cache:topics` (1h TTL), invalidated when `fetch:last` or clustering mode changes. `?refresh=1` bypasses. Returns `{topics, totalArticles, lastFetch, clusteringMode, cached}`. |
| `GET /api/stats` | none in-route | 48h hourly article counts. |
| `POST /api/articles/delete` | admin | Wipes Redis + DB articles. |

## `/news` and `/reports`

- **`/news`** (`NewsDashboard`): polls `/api/topics` every 5 min (paused on hidden tabs), stats bar, category filter, topic table. Requires the `news` section.
- **`/reports`** (`Dashboard` + `DashboardGrid`): a widget dashboard over the Plausible proxy `GET /api/plausible` (validated metrics/periods in `plausible-validate.ts`, limit cap 100, site validated against `PLAUSIBLE_SITE_IDS`). Widget types (`src/components/reports/widgets/`): `metric`, `timeseries`, `breakdown`, `pie`, `computed` (weighted sum over a numeric dimension), `computed_timeseries`, `article_breakdown` (pages under `/clanek/`), `entity_breakdown`. Layouts are drag-reorderable (dnd-kit) and persisted via `GET/PUT /api/dashboard-layout` with resolution order **user layout → admin default → static `default-config.ts`**; `saveMode` = `save_for_me` | `save_as_default` (admin) | `restore_default`. Requires the `reports` section.
- ⚠️ `GET /api/plausible` deliberately relies on the middleware cookie gate and does **not** re-check sections per call (it's hit 10+× per render).

## `/analyze`

Natural-language Q&A over Plausible via Claude tool use.

- `POST /api/analyze` (SSE stream, `maxDuration=120`): agent loop, model `claude-sonnet-4-6`, max 8 iterations, 20-turn history window. Emits `step` events (`ai_request`, `tool_request`, `tool_response`, `answer`, …) rendered by `AnalyzeView`/`Transcript`/`StepLog`.
- Tools (`src/lib/analyze/tools.ts`): `plausible_aggregate`, `plausible_timeseries`, `plausible_breakdown` — thin validated wrappers over `src/lib/plausible.ts`. The system prompt (`prompt.ts`) pins today's date, the selected site/period, filter syntax, and "never invent numbers".

## Gotchas

- Topic keywords come from titles only; summaries don't influence clustering.
- The `cache:topics:meta` Redis key is declared but unused.
- GNews cap (90) is deliberately under the free tier's 100/day.
- RSS parsing is regex-based, no XML library — fine for the curated feeds, brittle for arbitrary ones.
- `fetch-news` auth is inconsistent with the other crons: it opens up when `CRON_SECRET` is unset, while `article-monitor`/`coverage` reject everything in that case.
