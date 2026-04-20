"use client";

import { useState } from "react";
import type { MonitorConfig } from "@/types/dashboard";

interface Props {
  initial: MonitorConfig;
  sites: string[];
}

interface TickResult {
  ok: boolean;
  skippedReason?: string;
  sites?: {
    siteId: string;
    articles: number;
    sources?: number;
    authors?: number;
    titles?: number;
  }[];
  pruned?: {
    snapshots: number;
    monitors: number;
    sources?: number;
    authors?: number;
  };
  requestsThisHour?: number;
  error?: string;
}

export default function MonitorConfigForm({ initial, sites }: Props) {
  const [config, setConfig] = useState<MonitorConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [tickResult, setTickResult] = useState<TickResult | null>(null);

  function setField<K extends keyof MonitorConfig>(
    key: K,
    value: MonitorConfig[K]
  ) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function setPattern(siteId: string, pattern: string) {
    setConfig((prev) => ({
      ...prev,
      sitePatterns: { ...prev.sitePatterns, [siteId]: pattern },
    }));
  }

  function setRssUrl(siteId: string, url: string) {
    setConfig((prev) => {
      const next = { ...prev.siteRssUrls };
      const trimmed = url.trim();
      if (trimmed) next[siteId] = trimmed;
      else delete next[siteId];
      return { ...prev, siteRssUrls: next };
    });
  }

  function shortNamesToText(map: Record<string, string>): string {
    return Object.entries(map)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n");
  }

  function shortNamesFromText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && value) out[key] = value;
    }
    return out;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/monitor-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      const data = await res.json();
      setConfig(data.config);
      setMessage({ type: "success", text: "Saved" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setTickResult(null);
    try {
      const res = await fetch("/api/admin/monitor-run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTickResult(data);
    } catch (err) {
      setTickResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setField("enabled", !config.enabled)}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            config.enabled ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              config.enabled ? "left-5" : "left-0.5"
            }`}
          />
        </button>
        <div>
          <p className="text-sm font-medium text-gray-900">Enabled</p>
          <p className="text-xs text-gray-500">
            When off, cron ticks do nothing and no Plausible calls are made.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          label="Interval (seconds)"
          hint="Expected time between cron ticks. Floor: 60."
          value={config.intervalSeconds}
          onChange={(v) => setField("intervalSeconds", v)}
          min={60}
        />
        <NumberField
          label="Window (hours)"
          hint="How recent an article must be to appear on /monitor."
          value={config.windowHours}
          onChange={(v) => setField("windowHours", v)}
          min={1}
        />
        <NumberField
          label="Retention (days)"
          hint="Snapshots older than this are pruned each tick."
          value={config.retentionDays}
          onChange={(v) => setField("retentionDays", v)}
          min={1}
        />
        <NumberField
          label="Max Plausible calls / hour"
          hint="Hard cap on API usage. Each tick uses one call per configured site (plus N per source-sampled article when enabled)."
          value={config.maxRequestsPerHour}
          onChange={(v) => setField("maxRequestsPerHour", v)}
          min={1}
        />
        <NumberField
          label="Trend window (minutes)"
          hint="Window used to compute the per-article trend KPI on /monitor."
          value={config.trendWindowMinutes}
          onChange={(v) => setField("trendWindowMinutes", v)}
          min={5}
        />
        <NumberField
          label="Top sources shown"
          hint="How many rows to render in the Top sources widget on /monitor (after admin exclusions)."
          value={config.topSourcesLimit}
          onChange={(v) => setField("topSourcesLimit", v)}
          min={3}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setField("sourceSamplingEnabled", !config.sourceSamplingEnabled)
            }
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.sourceSamplingEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.sourceSamplingEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Per-article source sampling
            </p>
            <p className="text-xs text-gray-500">
              Each tick, pull a visit:source breakdown for the top N articles so
              the monitor expansion panel can show stored source data. When off,
              the expansion panel falls back to one on-demand Plausible call.
            </p>
          </div>
        </div>
        <div className="mt-3 max-w-xs">
          <NumberField
            label="Top N articles to sample"
            hint="One additional Plausible call per article per tick per site."
            value={config.sourceSamplingTopN}
            onChange={(v) => setField("sourceSamplingTopN", v)}
            min={1}
          />
        </div>
        <div className="mt-4 flex items-start gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() =>
              setField(
                "sourceTimeseriesEnabled",
                !config.sourceTimeseriesEnabled
              )
            }
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.sourceTimeseriesEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.sourceTimeseriesEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Show source-over-time chart in article detail
            </p>
            <p className="text-xs text-gray-500">
              Only meaningful with source sampling enabled above — the chart
              uses stored per-tick snapshots of the top 5 sources per article.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-900">
          Excluded sources
        </h3>
        <p className="mb-2 text-xs text-gray-500">
          Sources matching any of these (case-insensitive substring) are hidden
          from Top sources on /monitor and from the per-article sources panel.
          Typical use: hide internal referrers. One per line.
        </p>
        <textarea
          value={config.excludedSources.join("\n")}
          onChange={(e) =>
            setField(
              "excludedSources",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            )
          }
          placeholder={"seznam.cz\nwww.seznam.cz"}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-900">
          Article URL patterns
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          JavaScript regex applied to the Plausible{" "}
          <code className="rounded bg-gray-100 px-1 text-[11px]">page</code>{" "}
          value to decide what counts as an article. Empty means &ldquo;any non-root
          path&rdquo;. Example:{" "}
          <code className="rounded bg-gray-100 px-1 text-[11px]">^/(a|clanek)/</code>.
        </p>
        {sites.length === 0 ? (
          <p className="text-sm text-amber-600">
            No sites configured — set{" "}
            <code className="rounded bg-gray-100 px-1 text-[11px]">PLAUSIBLE_SITE_IDS</code>{" "}
            first.
          </p>
        ) : (
          <div className="space-y-2">
            {sites.map((siteId) => (
              <div key={siteId} className="flex items-center gap-3">
                <code className="w-40 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  {siteId}
                </code>
                <input
                  type="text"
                  value={config.sitePatterns[siteId] ?? ""}
                  onChange={(e) => setPattern(siteId, e.target.value)}
                  placeholder="^/a/"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setField("rssEnabled", !config.rssEnabled)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.rssEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.rssEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">RSS title + image sync</p>
            <p className="text-xs text-gray-500">
              Each cron tick fetches the RSS feed for each site and records the
              article title (and first image enclosure). Title changes are
              appended to the title history so you can see how titles evolve.
              Articles not present in the feed fall back to the path-derived
              name.
            </p>
          </div>
        </div>

        {sites.length > 0 && (
          <div className="mt-4 space-y-2">
            {sites.map((siteId) => (
              <div key={siteId} className="flex items-center gap-3">
                <code className="w-40 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  {siteId}
                </code>
                <input
                  type="url"
                  value={config.siteRssUrls[siteId] ?? ""}
                  onChange={(e) => setRssUrl(siteId, e.target.value)}
                  placeholder="https://example.com/rss"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-start gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() =>
              setField("showArticleImages", !config.showArticleImages)
            }
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.showArticleImages ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.showArticleImages ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Show article images on /monitor
            </p>
            <p className="text-xs text-gray-500">
              Displays the RSS image as a small thumbnail in the article row
              and a capped preview in the detail panel. Only images already
              stored via RSS sync are shown; the browser downloads them
              directly from the publisher.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-900">
          Author short names
        </h3>
        <p className="mb-2 text-xs text-gray-500">
          Mapping from short form to full name, applied when rendering
          authors in the article detail. One per line, format{" "}
          <code className="rounded bg-gray-100 px-1 text-[11px]">
            short = Full Name
          </code>
          .
        </p>
        <textarea
          value={shortNamesToText(config.authorShortNames)}
          onChange={(e) =>
            setField("authorShortNames", shortNamesFromText(e.target.value))
          }
          placeholder={"jk = Jan Krampol\nmh = Martin Havel"}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="mt-4 flex items-start gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() =>
              setField("authorSamplingEnabled", !config.authorSamplingEnabled)
            }
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.authorSamplingEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.authorSamplingEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Author sampling
            </p>
            <p className="text-xs text-gray-500">
              Each tick, pull the top authors (custom goal{" "}
              <code className="rounded bg-gray-100 px-1 text-[11px]">author</code>
              {" "}with property{" "}
              <code className="rounded bg-gray-100 px-1 text-[11px]">name</code>)
              for the top-N articles and store them so author tags can render
              inline on the main monitor row. Costs one Plausible call per
              sampled article per tick per site.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setField("externalRssEnabled", !config.externalRssEnabled)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.externalRssEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.externalRssEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              External RSS sync (Coverage tab)
            </p>
            <p className="text-xs text-gray-500">
              Pulls competitor RSS feeds into the database so the Coverage tab
              can compare their headlines to ours. Runs via a separate QStash
              job hitting{" "}
              <code className="rounded bg-gray-100 px-1 text-[11px]">
                /api/cron/coverage
              </code>{" "}
              with the same{" "}
              <code className="rounded bg-gray-100 px-1 text-[11px]">
                CRON_SECRET
              </code>
              . You can also trigger it manually from the Coverage tab.
            </p>
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium uppercase text-gray-500">
            External RSS feed URLs (one per line)
          </label>
          <textarea
            value={config.externalRssUrls.join("\n")}
            onChange={(e) =>
              setField(
                "externalRssUrls",
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
              )
            }
            placeholder={"https://www.novinky.cz/rss\nhttps://www.idnes.cz/rss"}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4 flex items-start gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() => setField("coverageEnabled", !config.coverageEnabled)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              config.coverageEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                config.coverageEnabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-900">
              AI coverage analysis
            </p>
            <p className="text-xs text-gray-500">
              After each external-RSS fetch, ask the configured Anthropic model
              (uses your{" "}
              <code className="rounded bg-gray-100 px-1 text-[11px]">
                ANTHROPIC_API_KEY
              </code>
              ) to decide whether each new external article is covered by our
              recent titles, and score its importance 1-5. Only unanalysed
              articles in the window are sent, so cost grows with new items.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField
            label="Coverage window (hours)"
            hint="How far back to compare external articles and our recent titles."
            value={config.coverageWindowHours}
            onChange={(v) => setField("coverageWindowHours", v)}
            min={1}
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
              Coverage model
            </span>
            <input
              type="text"
              value={config.coverageModel}
              onChange={(e) => setField("coverageModel", e.target.value)}
              placeholder="claude-haiku-4-5-20251001"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Anthropic model id used for the coverage analysis.
            </span>
          </label>
        </div>
      </div>

      {config.updatedAt && (
        <p className="text-xs text-gray-400">
          Last updated by {config.updatedBy || "unknown"} at{" "}
          {new Date(config.updatedAt).toLocaleString()}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          title={
            config.enabled
              ? "Run one tick of the monitor pipeline now"
              : "Enable the monitor first"
          }
        >
          {running ? "Running…" : "Run now"}
        </button>
        {message && (
          <span
            className={`text-sm ${
              message.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {message.text}
          </span>
        )}
      </div>

      {tickResult && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            tickResult.ok === false || tickResult.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-gray-200 bg-gray-50 text-gray-700"
          }`}
        >
          {tickResult.error ? (
            <p>Error: {tickResult.error}</p>
          ) : tickResult.skippedReason ? (
            <p>
              Skipped: <strong>{tickResult.skippedReason}</strong>
              {typeof tickResult.requestsThisHour === "number" &&
                ` (requests this hour: ${tickResult.requestsThisHour})`}
            </p>
          ) : (
            <div className="space-y-1">
              <p className="font-medium text-gray-900">Tick complete</p>
              <ul className="list-disc pl-5 text-xs text-gray-600">
                {tickResult.sites?.map((s) => (
                  <li key={s.siteId}>
                    <code className="rounded bg-white px-1">{s.siteId}</code>
                    : {s.articles} article{s.articles === 1 ? "" : "s"}
                    {typeof s.sources === "number" &&
                      `, ${s.sources} source row${s.sources === 1 ? "" : "s"}`}
                    {typeof s.authors === "number" && s.authors > 0 &&
                      `, ${s.authors} author row${s.authors === 1 ? "" : "s"}`}
                    {typeof s.titles === "number" && s.titles > 0 &&
                      `, ${s.titles} title change${s.titles === 1 ? "" : "s"}`}
                  </li>
                ))}
                <li>
                  Pruned snapshots: {tickResult.pruned?.snapshots ?? 0}, sources:{" "}
                  {tickResult.pruned?.sources ?? 0}, stale monitors:{" "}
                  {tickResult.pruned?.monitors ?? 0}
                </li>
                <li>
                  Plausible calls this hour:{" "}
                  {tickResult.requestsThisHour ?? 0}
                </li>
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <span className="mt-1 block text-xs text-gray-500">{hint}</span>
    </label>
  );
}
