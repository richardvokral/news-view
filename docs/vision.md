# Vision

## What news-view is for

news-view is Echo Media's internal newsroom copilot. It exists to answer three editorial questions continuously and in one place:

1. **What is happening right now?** — ingested wires/RSS/news APIs clustered into topics (`/news`, `/reports`), competitor coverage comparison, Google Trends.
2. **How is our own content performing?** — near-real-time per-article traffic, sources, and authors (`/monitor`, `/analyze`), so editors can react while an article is still alive (retitle, repromote, follow up).
3. **Is our copy clean?** — AI Czech proofreading inside the CMS via the Chrome extension, so quality control doesn't add a workflow step.

The unifying idea: **shorten the loop between publishing and editorial reaction**. Everything in the tool should either surface a signal faster or make acting on the signal cheaper.

## Product principles

- **Editor-first, not analyst-first.** Screens answer "what should I do next?" (retitle this, cover that story, promote this author's piece), not "export a report".
- **Near-real-time beats precise.** A 5-minute-fresh approximate number is worth more in a newsroom than a day-old exact one. We snapshot and interpolate rather than warehouse.
- **Cheap by construction.** Rate caps, snapshot pruning, Redis caches, and polling pauses are features, not afterthoughts — the tool must stay well inside free/low API tiers and Vercel CPU budgets.
- **Runtime-configurable.** Feature knobs live in the DB/Redis and are edited at `/admin/*`, not in env vars or redeploys. Env is for secrets and infrastructure only.
- **Degrade gracefully.** Any external dependency (Plausible, news APIs, RSS, Trends, AI providers) failing should dim a panel, never take down a surface.

## Where it's going

### 1. Ubiquitous article insight tracking (current priority)

Today article insight tracking is hard-wired to Plausible: site list from `PLAUSIBLE_SITE_IDS`, metrics from the Plausible v1 stats API, and Plausible-specific semantics (cumulative-since-midnight visitors) baked into the pipeline and UI. That limits the monitor to properties that run Plausible.

The goal is to make insight tracking **analytics-platform-agnostic** so any Echo Media property — or a newly acquired/partner site on Google Analytics 4, Matomo, Gemius, or anything else — can appear on `/monitor` with the same sparklines, trend flames, source breakdowns, and coverage cross-references. Design: `docs/plans/article-insights-providers.md`.

Second axis of "ubiquitous": the insights should reach editors where they already are — Slack/email spike alerts and digests, the Chrome extension (per-article stats displayed in the CMS while editing), and eventually a push API so platforms we cannot poll can send us data.

### 2. From dashboards to signals

The monitor already computes trend slopes and first-hour KPIs. Next step is turning those into **notifications with thresholds** (article spiking, title change correlated with traffic jump, competitor covered a story we haven't) rather than requiring editors to keep a tab open.

### 3. Deeper AI assistance

- Coverage analysis (done for competitor RSS) extended to suggest *assignments*: "3 competitors covered X in the last 2h; we have nothing".
- Title A/B insight: we store title history; correlate title changes with traffic inflections and summarize what works.
- Analyze tab grows from Q&A into scheduled editorial reports.

### 4. Proofreading as a platform

The proofread stack (router, prompts, usage accounting, per-user config) generalizes to other in-CMS assists: headline suggestions, SEO/social variants, summary boxes. The extension is the delivery channel; the admin console is the control plane.

## Non-goals

- Not a public-facing product; auth, UI language, and ops assume one newsroom.
- Not a data warehouse or long-term analytics store **for the real-time path** — the monitor's per-tick snapshots are deliberately pruned to days, and the analytics platform of record stays the source of truth.
  - The one deliberate exception is `/insights` (see [`insights.md`](insights.md)): small **weekly aggregates**, one row per article per week, kept indefinitely. Comparing this September with last September is the point, and the volume — roughly 500 articles x 52 weeks per site per year — is nothing like a warehouse. Cost stays bounded by the scope each analysis picks, not by retention.
- Not a CMS. We read from and annotate the editorial workflow; we don't own content storage.
