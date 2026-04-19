# Phase B: Article performance monitoring (deferred)

This feature is **not yet implemented**. The schema placeholders (`article_monitors`, `article_metric_snapshots`) already exist in `src/lib/db-schema.sql` so Phase B migrations are a no-op.

## Goal

For each Plausible site we monitor, discover new article pages as they appear in Plausible traffic, then snapshot their short-window metrics at a configurable interval (default 5 minutes) so editors can see how fresh pieces perform over time.

## Sketch

1. **Discovery** — a cron tick calls Plausible `breakdown` by `event:page` with a short period (e.g. `period=day`) for each `PLAUSIBLE_SITE_IDS` entry. Pages that look like articles (heuristic: path matches a configured regex, e.g. `^/clanek/` or `^/[0-9]{4}/`) and aren't already in `article_monitors` get inserted.
2. **Snapshotting** — for every row in `article_monitors` still in its monitoring window, call Plausible with a tight period and store the `visitors` and `pageviews` counts into `article_metric_snapshots` (`window_seconds` = the interval).
3. **Surfacing** — add a dashboard widget type (e.g. `article_monitor`) that plots one article's 5-minute-bucket timeseries from our own DB (not Plausible), so we keep history even after Plausible ages it out.
4. **AI summaries (optional)** — run titles of the top-performing new articles through the already-installed Anthropic SDK to produce short trend blurbs.

## Admin knobs

- `article_monitor_interval_seconds` — stored in a to-be-added `app_settings(key, value)` table or in `dashboard_defaults` JSON.
- Heuristic for "is this an article" — a per-site regex, also admin-editable.
- Monitoring window (how long to keep snapshotting after first seen) — default 24h.

## Cron wiring

Reuse the existing `vercel.json` cron + Upstash QStash pattern that `/api/cron/fetch-news` already uses. One new endpoint `/api/cron/article-monitor` runs both discovery + snapshotting per site; guard with `CRON_SECRET`.

## Not doing in this pass

- Live UI on `/reports` (widget type exists only as a placeholder).
- Cross-site article de-dup.
- Retention / cleanup of old snapshots.
