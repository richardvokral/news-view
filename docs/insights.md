# Insights: most-read articles, themes, and headline analysis

`/insights` answers "what did people actually read over the last months, what were the themes, and what kind of headline earns traffic?" — the long-horizon counterpart to `/monitor`'s 48-hour view.

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

## Part 5 — Title analysis, playbooks and the rewriter

Three connected pieces answering "what kind of headline earns traffic, and how do I fix this one".

### Titulky — the analysis (`src/lib/insights/titleAnalysis.ts`, `titleRun.ts`)

Four cohorts, shown side by side because they answer different questions:

| Cohort | What it is |
| --- | --- |
| normalizovaní vítězové / propadáky | Article against the **median of its own section in the week it debuted** — this is where the title's contribution shows. |
| absolutní vítězové / propadáky | Highest and lowest outright — mostly surfaces popular *topics*. |

The contrast is the point. If the two agree perfectly, the normalisation isn't doing its job.

**Scoring.** `ln((pv + 1) / (bucket median + 1))` over a fixed exposure window `[debut week, debut week + titleTailWeeks]`. Log-ratio because it is symmetric: 2× and 0.5× become +0.69 and −0.69, so a top-vs-bottom read isn't skewed by construction. The window is identical for every article, so its value and the bucket median are literally the same statistic — that dissolves the "article accrues traffic for weeks, median is weekly" mismatch rather than patching it.

**Three guards, each protecting against a silent failure:**

- **Truncated weeks are excluded entirely.** A truncated week hit the page cap, so it is missing its long tail — its low performers are *absent, not zero*. Feed one in and "bottom" is actually the middle of the distribution, inverting the whole feature. This is the single most dangerous failure mode here and the reason `insights_backfill_weeks` is joined at all.
- **Left-censoring.** An article whose debut equals the earliest loaded week was already live before we started looking; its debut was never observed.
- **No per-week row requirement.** Plausible omits zero-traffic pages, so a genuine flop has *no row* in a later week. Requiring one would delete exactly the articles this feature exists to find.

**Small-sample handling.** A `(section, debut week)` bucket needs `MIN_BUCKET_ARTICLES` (12) to be used; thinner buckets fall back to an all-sections bucket for that week, which re-introduces the topic confound — so the level is recorded and the count is reported in the caveats rather than hidden. `titleMinPageviews` (default 10) exists to exclude mis-parsed paths, not genuine flops; a one-view article against a median of 200 is real signal.

**Cohort balancing.** Live blogs and serials ("Válka na Ukrajině — 512. den") produce dozens of near-identical titles. Each `(section, debut week)` bucket contributes at most `ceil(size / 12)` to any cohort — otherwise the model confidently reports that serial numbering underperforms, when the real cause is that live blogs accrue traffic differently.

**What the model sees:** `idx|cohorts|sections|title`, with `~` marking a slug-derived title and an explicit instruction not to infer anything from missing punctuation there. No numbers. Every figure in the output — pattern counts, median ratios, slug share — is computed server-side from the rows.

### The playbook

The same call returns `playback_draft`: Czech rules for writing headlines, written as instructions rather than as a report, because it will later be fed back to a model. The Titulky tab shows it in an editable box; **Uložit jako playbook** writes an `insights_prompts` row with `kind='title_rewrite'`, the `site_id` it was measured on, and `derived_from_run_id`.

Playbooks are **per site with a shared fallback** — rules learned from one masthead's audience shouldn't quietly drive another's headlines. Keys are namespaced (`title:<siteId>:<name>`) rather than adding a composite unique constraint, since `ADD CONSTRAINT` has no `IF NOT EXISTS` form.

Save-time validation rejects any rule line containing a digit or `%`: a playbook is model-generated prose a human lightly edited, so a hallucinated statistic can ride along unnoticed. A Czech number-*word* regex is deliberately not attempted — "nepoužívej víc než dvě jména" is a legitimate rule — the output contract handles the prose case instead.

### Přepsat titulek — the rewriter (`src/lib/insights/titleRun.ts`)

Paste a Czech headline, optionally with section and perex, pick a playbook and a model; get a critique plus 3–5 variants, each citing the playbook rules it applies.

**This is the hardest thing in the feature to keep honest**, because unlike the theme analysis there are no rows to recompute against — nothing is verifiable after the fact, so the contract *is* the guarantee. Four layers:

1. **Position.** `REWRITE_CONTRACT` comes last in the system message, with a closing override naming the concrete poisoned instructions ("odhadni nárůst čtenosti", "seřaď podle očekávaného CTR").
2. **The playbook travels in the *user* message**, tagged as data — a deliberate divergence from the analysis prompts, whose bodies are admin-authored and sit in the system message. A playbook is model-generated, so it is treated as data, never as instruction.
3. **Numbered rules.** The model returns `rule_ids`, and the server validates every id against the real playbook, dropping unknowns — the same reconciliation `article_indexes` gets in the theme analysis. Free-text rule labels would be unverifiable.
4. **Server enforcement.** Prose fields containing a digit, or Czech performance phrases (`čtenost`, `CTR`, `bude fungovat lépe`), raise a visible warning. Digit runs in a variant title that don't appear in the submitted title are flagged per variant — a rewriter that turns "Ministr komentoval rozpočet" into "Ministr Stanjura: rozpočet je v troskách" has fabricated a quote, which in a newsroom is worse than a made-up percentage.

The submitted title is sanitised before any prompt exists: control characters stripped, tag delimiters removed, collapsed to one line, capped at 300 characters. A multi-paragraph instruction block cannot survive that.

## Part 6 — Fetching real titles (`src/lib/insights/titleFetch.ts`)

Admin-only, at `/admin/insights`. Reads `og:title` from the site's own article pages, chunked with the same lock/cancel/deadline shape as the Plausible backfill.

- **Only touches pages with no real title** (`headline_source = 'slug'`), so an RSS title is never downgraded. The RSS title was captured at publication — it is the headline that earned the clicks, which is the right one for a performance analysis.
- **Reads only to `</head>` or 64 KB.** Article pages run 300–800 KB; without the cap a run would pull over a gigabyte for a single meta tag.
- **Redirect check compares the short id**, not the full path. A redirect to the homepage or a section returns HTTP 200 with a perfectly good og:title — the *section's* title — which would poison the corpus with the same headline hundreds of times.
- **Paywalls are parsed anyway.** A 401/403/429 page usually still serves og:title for crawlers, and that is the difference between enriching 40% and 95% of a paywalled site.
- **Quality gate** rejects error-page titles, very short ones, and — the one that matters — any multi-word "title" with no Czech diacritics at all, which is almost certainly a slug echo and adds nothing over what we already have.
- Suffix stripping is **configuration only**. A generic dash rule would happily eat the second half of "Zemřel Karel Gott – legenda české hudby".

Uses its own hourly budget, not the monitor's shared Plausible counter — these are requests to a different origin entirely.

## Tables

| Table | Purpose |
| --- | --- |
| `insights_pages` | One row per article per site: short id, slug, sections, headline, title, `headline_source`. |
| `insights_page_weeks` | The facts: one row per article per week with visitors, pageviews, visits and the optional session metrics. |
| `insights_backfill_weeks` | Ingest ledger keyed `(site_id, week_start)` — the durable answer to "what still needs loading". Not derived from the facts, because a week with genuinely zero traffic would otherwise look missing forever. |
| `insights_backfill_runs` | Run header, so a chunked backfill reads as one operation. |
| `insights_config` | Singleton knobs. |
| `insights_prompts` | Editable analysis prompts and saved title playbooks (`kind`, `site_id`, `derived_from_run_id`). |
| `insights_ai_runs` | Stored runs for all three AI features (`kind` = `themes` / `titles` / `rewrite`): scope, prompt snapshot, model, result, tokens, cost. |

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
| `POST /api/insights/title-analysis` | `insights` + rate limit | Cohort analysis + playbook draft. |
| `GET/POST /api/insights/playbooks` | `insights` | List and save title playbooks. |
| `POST /api/insights/rewrite` | `insights` + rate limit | Critique and variants for one headline. |
| `GET/PUT /api/admin/insights/prompts` | admin | Prompt editor. |
| `GET/POST /api/admin/insights/title-fetch` | admin | og:title enrichment and coverage. |
| `GET /api/admin/insights/section-suggestions` | admin | Leading-token frequencies for vocabulary discovery. |

## Cost guards

The `insights` grant can spend both Plausible quota and AI tokens, so limits are the guard:

| | Fetch | Analyse |
| --- | --- | --- |
| Per user | 5/h | 10/h (analysis), 60/h (rewrite) |
| Per site, all users | 20/h | 40/h (analysis), 200/h (rewrite) |
| Inside the run | `max_requests_per_run` calls, shared hourly counter | `topN` cap (600 hard) |

`rate-limit.ts` fails open when Redis is down. For the fetch path that is acceptable because the lock and the in-run call budget are separate backstops.

## Gotchas

- `maxDuration` must be a literal in a route file, so `/api/insights/backfill` hardcodes `300` — keep it in sync with `BACKFILL_MAX_DURATION_S`, which derives the loop deadline.
- The path filter (`article_path_filter`, e.g. `/a/**`) is a bandwidth optimisation only; the local regex is always applied and is the correctness boundary. Wildcard support varies across Plausible versions — if the filter returns nothing, clear it and filter locally.
- `views_per_visit` is in `VALID_METRICS` but is unsupported on breakdown endpoints, so `/api/plausible?endpoint=breakdown&metrics=views_per_visit` 400s upstream. Pre-existing, unrelated to insights, worth fixing separately.
- `src/lib/monitor/pipeline.ts` interpolates page paths into Plausible `filters` unescaped; a path containing `;`, `|` or `*` changes what the query means rather than erroring. `isFilterSafeValue` in `src/lib/plausible.ts` exists for this — the monitor isn't using it yet.
