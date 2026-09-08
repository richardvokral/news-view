# Insights: most-read articles + AI theme analysis

`/insights` answers "what did people actually read over the last months, and what were the themes?" — the long-horizon counterpart to `/monitor`'s 48-hour view.

It is deliberately **two separate halves**: loading data from Plausible, and analysing it with an AI. They share nothing but the tables, so an analysis costs no Plausible calls and a reload costs no AI tokens.

## Why this stores history when the rest of the app doesn't

`docs/vision.md` says news-view is "not a data warehouse — retention is days, not years". That still holds for the monitor's per-tick snapshots, which are pruned aggressively. Insights is the deliberate exception: **weekly aggregates**, one row per article per week, kept indefinitely. Roughly 500 articles × 52 weeks × sites per year — small enough that nothing prunes it, and comparing this September to last September is the entire point.

Cost is bounded by **scope per run**, not by retention: every analysis picks its own week range, sections and article count.

## Part 1 — Loading (`src/lib/insights/backfill.ts`)

Manual, chunked, abortable.

```
POST /api/insights/backfill  { site, weeks?, runKey? }
  -> { ok, runKey, processed[], remaining, refreshedCurrentWeek,
       apiCallsUsed, metricsTier, skippedReason?, aborted? }
```

The client loops until `remaining === 0`. Each request handles up to `weeks_per_request` weeks and stops early on a wall-clock deadline (240 s, inside the 300 s `maxDuration`), so a dropped response is harmless — the next call re-derives the outstanding weeks from the ledger.

**Weeks** are Monday–Sunday, sent as `period=custom&date=<start>,<end>`. ⚠️ Plausible interprets those in the *site's* timezone, not UTC, so don't describe them as UTC weeks.

**What gets re-fetched** (`needsFetch`): anything with no ledger row, a non-`ok` status, `truncated`, still `is_partial`, or last fetched before its settle-up window (`refetch_grace_hours`, default 48 h after the week ends). The current week is always re-fetched and is **excluded from `remaining`** — otherwise the progress bar never reaches zero. Weeks are processed newest-first, so a run that stops early still leaves the useful part.

**Abort boundaries** — the reconciliation of "abort on error" with "don't lose what landed":

| Level | Rule |
| --- | --- |
| Per API call | No retries. |
| Per week | All-or-nothing. Every page is collected in memory, then written once. A failure writes nothing for that week and marks the ledger row `error`. |
| Per run | The first week-level failure stops the loop. Already-committed weeks stay. |

**Concurrency:** Redis lock `insights:backfill:lock:<siteId>`, released with a check-and-delete so a slow run can't stomp its successor's lock. It **fails closed** if Redis is unreachable (`skippedReason: "redis_unavailable"`) — deliberately unlike `src/lib/rate-limit.ts`, which fails open. Two concurrent backfills would burn the shared Plausible quota.

**Cancellation:** `POST /api/insights/backfill/cancel { runKey }` sets a Redis flag checked *between* weeks, so per-week atomicity holds.

### Metric ladder

Whether Plausible accepts session metrics on an `event:page` breakdown varies by version, so the fetcher probes once per run and steps down on a metric-shaped 400 (`METRIC_TIERS` in `types.ts`):

| Tier | Metrics |
| --- | --- |
| 0 | visitors, pageviews, visits, bounce_rate, visit_duration, time_on_page |
| 1 | visitors, pageviews, visits, bounce_rate, visit_duration |
| 2 | visitors, pageviews, visits |
| 3 | visitors, pageviews (guaranteed floor) |

Only the probe may step down. Once a tier is proven for the run, any later error — 400 included — is a hard abort; retrying then is exactly the hammering to avoid. The winning tier is stored per week, so a `0` bounce rate is distinguishable from "never measured".

`visits` earns its own tier because **bounce_rate and visit_duration are session metrics**: averaging them across weeks must be weighted by visits. Weighting by pageviews would be silently wrong.

### Two counting traps

- **`SUM(visitors)` overcounts uniques.** A reader active in three weeks counts three times. Only pageviews sum cleanly. The field is called `visitorsSum` everywhere and the UI carries a footnote — don't quietly rename it to "visitors".
- **`bounce_rate`/`visit_duration` on `event:page` describe the sessions associated with a page**, not reading time. Don't let the UI or the AI narrate them as engagement-with-this-article.

### Rate budget

The Plausible limit (600 req/h by default) is **per API key and shared with the monitor**, so the backfill spends from the monitor's counter (`monitor:requests:<hour>`) rather than a private one — a separate budget would let a backfill trip a 429 that also kills the monitor.

A 6-month backfill of one site costs roughly 55–80 calls with a path filter configured, 160–400 without. With a 5-minute monitor tick (~250 calls/h) there is ~340/h of headroom, so a filtered backfill fits in one hour and an unfiltered worst case needs two.

## Part 2 — URL parsing (`src/lib/insights/paths.ts`)

```
/a/HWpj2/zpravy-domov-klaus-ostre-kritizuje-pavla-...
 │  │     │      │      └── headline words
 │  │     └──────┴───────── sections
 │  └────────────────────── short id
 └───────────────────────── article prefix
```

At most **two** leading tokens become sections, and only if they are in the admin-managed vocabulary (`insights_config.section_vocabulary`). This matters: "the first one or two words are sections" would eat headline words — in `sport-hokej-…` only a vocabulary can say whether `hokej` is a section. An unknown prefix yields no sections rather than a guess, and the parser never consumes the whole slug.

**Discovery instead of guessing:** `/admin/insights` → *Najít v datech* counts how often each token appears in leading position across stored slugs and offers the frequent ones as clickable chips. Load data first, then build the vocabulary from what's actually there.

**Diacritics are lost for good** (`ostre` can't become `ostře`). Where the monitor's RSS sync has a real title (`article_titles`), `syncTitlesFromMonitor` copies it in and `headline_source` flips to `title`. That only covers the monitor's retention window, so most of a 6-month backfill keeps de-slugified text — the UI marks those with `~` and the analysis reports `titleBackedShare`.

## Part 3 — AI analysis (`src/lib/insights/{analyze,providers,ground,prompts}.ts`)

### The model cannot state a number

The contract: the model returns **prose plus article indexes**, nothing else. Then `groundAnalysis` recomputes every figure by joining indexes back to the real rows.

Two reinforcing mechanisms:

1. **Rank bands, not metrics.** The payload gives each article `#1-10` / `#11-50` / `#51-150` / `#151+` instead of pageviews. The salience signal survives; there is no numeral in context to parrot.
2. **Reconciliation.** Out-of-range indexes are dropped, duplicates go to the first theme, and everything unclaimed becomes an `unassigned` pseudo-theme. `assigned + unassigned === total` always holds — a model returning nothing yields "everything unassigned", never wrong numbers.

| AI-authored | Server-computed |
| --- | --- |
| theme names, summaries, "why it worked" | every count, sum, share, average, median |
| theme membership (by index) | trend direction (least-squares over weekly points) |
| headline-pattern labels and membership | pattern `avgPageviews` and `liftPct` |
| observations, recommendations | section table (from parsed slugs, **not** the model's labels) |

The AI's own section guesses are kept separately as `aiSectionLabels` and displayed alongside the computed `sectionMix`. When they disagree that's editorially interesting, not a bug.

### Prompts

`insights_prompts` holds the editable half — persona, what counts as a theme, granularity, tone. `INSIGHTS_OUTPUT_CONTRACT` is appended in code and holds the non-negotiable half: the output shape, index-only references, one theme per article, **never write a number**, and the anti-injection wrapper. It comes last and ends with an explicit override, so an edited prompt cannot loosen it. Same construction as `OUTPUT_CONTRACT` in `src/lib/proofread/prompts.ts`.

Prompts are seeded from TypeScript (`DEFAULT_INSIGHTS_PROMPTS`, applied by `ensureDefaultPrompts()` on first read) rather than from `db-schema.sql` — the migrator splits on a line-ending `;` and strips `--` to end of line, so a Czech prompt body sitting in SQL is a migration break waiting to happen.

### Model selection

From the shared catalog via `src/lib/ai/models.ts` (physically `proofread_models`; treat the table name as history, not ownership). Resolution: explicit choice → `insights_config.ai_model_key` → app default → first enabled. Never a hardcoded id. Structured output is forced per provider exactly as proofread does it — Anthropic forced tool-use, OpenAI strict `json_schema` with a `json_object` fallback.

Cost per run is recorded in `insights_ai_runs` via the shared `estimateCost`. A 300-article run is roughly 15k input tokens: about 0.11 USD on Sonnet, 0.04 on Haiku.

## Tables

| Table | Purpose |
| --- | --- |
| `insights_pages` | One row per article per site: short id, slug, sections, headline, title, `headline_source`. |
| `insights_page_weeks` | The facts: one row per article per week with visitors, pageviews, visits and the optional session metrics. |
| `insights_backfill_weeks` | Ingest ledger keyed `(site_id, week_start)` — the durable answer to "what still needs loading". Not derived from the facts, because a week with genuinely zero traffic would otherwise look missing forever. |
| `insights_backfill_runs` | Run header, so a chunked backfill reads as one operation. |
| `insights_config` | Singleton knobs. |
| `insights_prompts` | Editable analysis prompts. |
| `insights_ai_runs` | Stored runs: scope, prompt snapshot, model, result, tokens, cost. |

## API surface

| Route | Auth | Does |
| --- | --- | --- |
| `POST /api/insights/backfill` | `insights` + rate limit | One chunk of the backfill. Returns 200 even on abort — the run partially succeeded and the client needs the payload. |
| `POST /api/insights/backfill/cancel` | `insights` | Sets the cancel flag. |
| `GET /api/insights/backfill-status` | `insights` | Per-week freshness for the progress panel. |
| `GET /api/insights/articles` | `insights` | Aggregated article table. |
| `POST /api/insights/analyze` | `insights` + rate limit | Runs and stores an analysis. |
| `GET /api/insights/analyses` | `insights` | Run history; `?id=` returns one with its full result. |
| `GET/PUT /api/admin/insights/config` | admin | Knobs, vocabulary, article pattern. |
| `GET/PUT /api/admin/insights/prompts` | admin | Prompt editor. |
| `GET /api/admin/insights/section-suggestions` | admin | Leading-token frequencies for vocabulary discovery. |

## Cost guards

The `insights` grant can spend both Plausible quota and AI tokens, so limits are the guard:

| | Fetch | Analyse |
| --- | --- | --- |
| Per user | 5/h | 10/h |
| Per site, all users | 20/h | 40/h |
| Inside the run | `max_requests_per_run` calls, shared hourly counter | `topN` cap (600 hard) |

`rate-limit.ts` fails open when Redis is down. For the fetch path that is acceptable because the lock and the in-run call budget are separate backstops.

## Gotchas

- `maxDuration` must be a literal in a route file, so `/api/insights/backfill` hardcodes `300` — keep it in sync with `BACKFILL_MAX_DURATION_S`, which derives the loop deadline.
- The path filter (`article_path_filter`, e.g. `/a/**`) is a bandwidth optimisation only; the local regex is always applied and is the correctness boundary. Wildcard support varies across Plausible versions — if the filter returns nothing, clear it and filter locally.
- `views_per_visit` is in `VALID_METRICS` but is unsupported on breakdown endpoints, so `/api/plausible?endpoint=breakdown&metrics=views_per_visit` 400s upstream. Pre-existing, unrelated to insights, worth fixing separately.
- `src/lib/monitor/pipeline.ts` interpolates page paths into Plausible `filters` unescaped; a path containing `;`, `|` or `*` changes what the query means rather than erroring. `isFilterSafeValue` in `src/lib/plausible.ts` exists for this — the monitor isn't using it yet.
