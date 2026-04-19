# Article monitor

Periodically pulls per-article pageviews from Plausible so editors can watch fresh articles in near-real time on `/monitor`. No CMS access required — we rely on Plausible's `event:page` breakdown.

## Runbook

1. **Migrate the DB** (once): sign in as an `ADMIN_EMAILS` user, then `fetch("/api/admin/migrate", { method: "POST" })` from the browser DevTools console, or paste `src/lib/db-schema.sql` into the Neon SQL editor.
2. **Grant access to the `monitor` section** — visit `/admin/users` or `/admin/domains` and tick the `monitor` checkbox for whoever should see `/monitor`.
3. **Configure** at `/admin/monitor`:
   - Toggle **Enabled**.
   - Set an article URL regex per site (e.g. `^/(a|clanek)/`). Empty = any non-root path.
   - Adjust interval / window / retention / rate cap if needed (see defaults below).
4. **Schedule the cron** in Upstash QStash (already wired into the project):
   - URL: `https://<your-url>/api/cron/article-monitor`
   - Method: POST or GET
   - Header: `Authorization: Bearer $CRON_SECRET`
   - Cadence: match your configured interval (default 300s = every 5 min).
5. Wait one tick. Users with the `monitor` section will see entries on `/monitor`.

## Defaults and caps

| Knob | Default | Purpose |
| --- | --- | --- |
| `enabled` | `false` | Master switch; cron is a no-op until flipped. |
| `intervalSeconds` | `300` | Expected cron cadence. Minimum 60s. |
| `windowHours` | `48` | How recent an article must be to show on `/monitor`. |
| `retentionDays` | `7` | Snapshots older than this are pruned each tick. |
| `maxRequestsPerHour` | `240` | Redis-backed hourly cap. Each tick uses 1 call per site. |

**Plausible budget**: at 5-min cadence and 2 sites → **24 calls/hour, 576/day**, well inside any plan. Adjust the cap if you add more sites or go faster.

## How snapshots work

- Each tick does one Plausible `breakdown` by `event:page` with `period=day&date=today`, limit 100.
- Rows matching the site's article regex are upserted into `article_monitors`.
- The cumulative `visitors` / `pageviews` for the page since midnight are written into `article_metric_snapshots`.
- The dashboard sparkline plots the running curve; the big number is the latest snapshot.
- Once per tick we prune snapshots older than `retentionDays` and monitor rows untouched for longer than `windowHours + 24h`.

## Failure modes

- **Plausible 4xx/5xx on one site**: logged, that site records 0 articles for the tick, other sites still run.
- **Over the rate cap**: tick returns `skippedReason: "rate_capped"`; nothing is inserted, counter persists until the hour rolls over.
- **Monitor disabled**: tick returns `skippedReason: "disabled"` immediately.
- **Plausible resets at midnight**: sparkline will appear to "drop" on the day boundary; visitors count resets. Displayed as-is (we store raw cumulative values).

## Not yet implemented (future work)

- OG-tag scraping for article thumbnail / author / published date (would require one HEAD/GET per newly-seen URL, cache forever).
- AI summaries of title trends via the already-installed Anthropic SDK.
- Cross-site article de-dup.
- Traffic-source breakdown per article (Google Search / Discover / News) to match the design reference.
- Per-site monitor section (currently all or nothing via ACL).
