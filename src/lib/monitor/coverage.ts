// Coverage cross-reference: for each not-yet-analysed external article,
// ask the AI whether any of our recent titles cover the same story.

import Anthropic from "@anthropic-ai/sdk";
import { getDb, hasDb } from "@/lib/db";
import { getApiConfig } from "@/lib/storage/settings";
import { getMonitorConfig } from "./config";
import {
  ingestAllExternalFeeds,
  listRecentExternals,
  type ExternalArticleRow,
  type IngestResult,
} from "./external-rss";

export interface CoverageRow {
  externalId: number;
  feedSource: string;
  title: string;
  link: string;
  pubDate: string | null;
  importedAt: string;
  covered: boolean;
  importance: number;
  matchedOurPaths: string[];
  rationale: string | null;
  analyzedAt: string | null;
  model: string | null;
}

interface OurArticle {
  pagePath: string;
  title: string;
}

async function listOurRecentTitles(
  siteId: string,
  windowHours: number
): Promise<OurArticle[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const { rows } = await getDb().query<{
    page_path: string;
    title: string | null;
  }>(
    `SELECT m.page_path, t.title
       FROM article_monitors m
       LEFT JOIN LATERAL (
         SELECT title FROM article_titles
          WHERE page_path = m.page_path
          ORDER BY captured_at DESC
          LIMIT 1
       ) t ON true
      WHERE m.site_id = $1 AND m.first_seen_at >= $2
      ORDER BY m.first_seen_at DESC
      LIMIT 200`,
    [siteId, cutoff]
  );
  return rows
    .filter((r) => r.title && r.title.trim().length > 0)
    .map((r) => ({ pagePath: r.page_path, title: r.title as string }));
}

async function listUnanalysedExternals(
  ourSiteId: string,
  windowHours: number,
  limit: number
): Promise<ExternalArticleRow[]> {
  if (!hasDb()) return [];
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const { rows } = await getDb().query<{
    id: string;
    feed_source: string;
    guid: string;
    title: string;
    link: string;
    description: string | null;
    pub_date: string | null;
    imported_at: string;
  }>(
    `SELECT e.id, e.feed_source, e.guid, e.title, e.link, e.description,
            e.pub_date, e.imported_at
       FROM external_articles e
       LEFT JOIN coverage_analysis c
         ON c.external_article_id = e.id AND c.our_site_id = $1
      WHERE c.id IS NULL
        AND COALESCE(e.pub_date, e.imported_at) >= $2
      ORDER BY COALESCE(e.pub_date, e.imported_at) DESC
      LIMIT $3`,
    [ourSiteId, cutoff, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    feedSource: r.feed_source,
    guid: r.guid,
    title: r.title,
    link: r.link,
    description: r.description,
    pubDate: r.pub_date,
    importedAt: r.imported_at,
  }));
}

interface AiVerdict {
  covered: boolean;
  importance: number;
  matched: string[];
  rationale: string;
}

function buildPrompt(
  external: ExternalArticleRow,
  ours: OurArticle[]
): string {
  const ourList = ours
    .slice(0, 150)
    .map((a, i) => `${i + 1}. ${a.title} [${a.pagePath}]`)
    .join("\n");
  const desc = (external.description || "").slice(0, 400);
  return `You are a news-desk editor comparing an external article to our site's recent coverage.

External article:
- Source: ${external.feedSource}
- Title: ${external.title}
- Description: ${desc}
- Published: ${external.pubDate ?? "unknown"}

Our recent articles (title [page_path]):
${ourList || "(none)"}

Decide whether any of our articles cover the same underlying news event (not just the same broad topic or category). Then rate how important the news is to a general Czech audience on a 1-5 scale (1 = niche/local, 5 = major national/international event).

Respond with STRICT JSON only — no markdown, no prose. Schema:
{"covered": boolean, "importance": 1-5, "matched": ["/path", ...], "rationale": "one short sentence"}

Rules:
- "matched" contains up to 3 page_paths from the list above that cover the same event.
- If covered is false, matched must be [].
- If covered is true, matched must contain at least one path.
- Keep rationale under 20 words.`;
}

function parseVerdict(text: string): AiVerdict | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const raw = JSON.parse(jsonMatch[0]) as {
      covered?: unknown;
      importance?: unknown;
      matched?: unknown;
      rationale?: unknown;
    };
    const covered = raw.covered === true;
    let importance = Number(raw.importance);
    if (!Number.isFinite(importance)) importance = 3;
    importance = Math.max(1, Math.min(5, Math.round(importance)));
    const matched = Array.isArray(raw.matched)
      ? raw.matched
          .filter((v): v is string => typeof v === "string")
          .slice(0, 3)
      : [];
    const rationale =
      typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    return { covered, importance, matched, rationale };
  } catch {
    return null;
  }
}

export interface CoverageRunResult {
  ok: true;
  skippedReason?: string;
  siteId: string | null;
  ingest: IngestResult[];
  analysed: number;
  covered: number;
  uncovered: number;
  errors: number;
  model: string;
}

export async function runCoverageTick(
  siteId: string,
  opts: { maxArticles?: number } = {}
): Promise<CoverageRunResult> {
  const cfg = await getMonitorConfig();
  if (!cfg.externalRssEnabled) {
    return {
      ok: true,
      skippedReason: "external_rss_disabled",
      siteId,
      ingest: [],
      analysed: 0,
      covered: 0,
      uncovered: 0,
      errors: 0,
      model: cfg.coverageModel,
    };
  }
  const ingest = await ingestAllExternalFeeds(cfg.externalRssUrls);

  if (!cfg.coverageEnabled) {
    return {
      ok: true,
      skippedReason: "coverage_disabled",
      siteId,
      ingest,
      analysed: 0,
      covered: 0,
      uncovered: 0,
      errors: 0,
      model: cfg.coverageModel,
    };
  }

  const api = await getApiConfig();
  const apiKey = api.clustering.anthropicApiKey;
  if (!apiKey) {
    return {
      ok: true,
      skippedReason: "no_anthropic_key",
      siteId,
      ingest,
      analysed: 0,
      covered: 0,
      uncovered: 0,
      errors: 0,
      model: cfg.coverageModel,
    };
  }

  const ours = await listOurRecentTitles(siteId, cfg.coverageWindowHours);
  if (ours.length === 0) {
    return {
      ok: true,
      skippedReason: "no_our_titles",
      siteId,
      ingest,
      analysed: 0,
      covered: 0,
      uncovered: 0,
      errors: 0,
      model: cfg.coverageModel,
    };
  }

  const maxArticles = opts.maxArticles ?? 30;
  const pending = await listUnanalysedExternals(
    siteId,
    cfg.coverageWindowHours,
    maxArticles
  );
  if (pending.length === 0) {
    return {
      ok: true,
      skippedReason: "no_new_externals",
      siteId,
      ingest,
      analysed: 0,
      covered: 0,
      uncovered: 0,
      errors: 0,
      model: cfg.coverageModel,
    };
  }

  const client = new Anthropic({ apiKey });
  let covered = 0;
  let uncovered = 0;
  let errors = 0;
  for (const ext of pending) {
    try {
      const prompt = buildPrompt(ext, ours);
      const resp = await client.messages.create({
        model: cfg.coverageModel,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });
      const text = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n");
      const verdict = parseVerdict(text);
      if (!verdict) {
        errors += 1;
        continue;
      }
      await getDb().query(
        `INSERT INTO coverage_analysis
           (our_site_id, external_article_id, covered, importance,
            matched_our_paths, rationale, model)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
         ON CONFLICT (our_site_id, external_article_id) DO UPDATE SET
           covered = EXCLUDED.covered,
           importance = EXCLUDED.importance,
           matched_our_paths = EXCLUDED.matched_our_paths,
           rationale = EXCLUDED.rationale,
           model = EXCLUDED.model,
           analyzed_at = NOW()`,
        [
          siteId,
          ext.id,
          verdict.covered,
          verdict.importance,
          verdict.matched,
          verdict.rationale,
          cfg.coverageModel,
        ]
      );
      if (verdict.covered) covered += 1;
      else uncovered += 1;
    } catch (e) {
      console.error(`coverage analyse failed for ext ${ext.id}:`, e);
      errors += 1;
    }
  }

  return {
    ok: true,
    siteId,
    ingest,
    analysed: covered + uncovered,
    covered,
    uncovered,
    errors,
    model: cfg.coverageModel,
  };
}

/**
 * Page paths we've stored titles for. Used by the list endpoint to show our
 * title alongside matched external ones.
 */
export async function listCoverageForSite(
  siteId: string,
  windowHours: number
): Promise<{
  externals: ExternalArticleRow[];
  analysisByExternalId: Map<
    number,
    {
      covered: boolean;
      importance: number;
      matchedOurPaths: string[];
      rationale: string | null;
      analyzedAt: string;
      model: string | null;
    }
  >;
  ourTitles: Map<string, string>;
}> {
  if (!hasDb()) {
    return {
      externals: [],
      analysisByExternalId: new Map(),
      ourTitles: new Map(),
    };
  }
  const externals = await listRecentExternals(windowHours);
  const ids = externals.map((e) => e.id);
  const analysisByExternalId = new Map<
    number,
    {
      covered: boolean;
      importance: number;
      matchedOurPaths: string[];
      rationale: string | null;
      analyzedAt: string;
      model: string | null;
    }
  >();
  if (ids.length > 0) {
    const { rows } = await getDb().query<{
      external_article_id: string;
      covered: boolean;
      importance: number;
      matched_our_paths: string[];
      rationale: string | null;
      analyzed_at: string;
      model: string | null;
    }>(
      `SELECT external_article_id, covered, importance, matched_our_paths,
              rationale, analyzed_at, model
         FROM coverage_analysis
        WHERE our_site_id = $1 AND external_article_id = ANY($2::bigint[])`,
      [siteId, ids]
    );
    for (const r of rows) {
      analysisByExternalId.set(Number(r.external_article_id), {
        covered: r.covered,
        importance: r.importance,
        matchedOurPaths: r.matched_our_paths ?? [],
        rationale: r.rationale,
        analyzedAt: r.analyzed_at,
        model: r.model,
      });
    }
  }
  const matchedPaths = Array.from(
    new Set(
      Array.from(analysisByExternalId.values())
        .flatMap((a) => a.matchedOurPaths)
        .filter(Boolean)
    )
  );
  const ourTitles = new Map<string, string>();
  if (matchedPaths.length > 0) {
    const { rows } = await getDb().query<{
      page_path: string;
      title: string;
    }>(
      `SELECT DISTINCT ON (page_path) page_path, title
         FROM article_titles
        WHERE page_path = ANY($1::text[])
        ORDER BY page_path, captured_at DESC`,
      [matchedPaths]
    );
    for (const r of rows) {
      if (r.title) ourTitles.set(r.page_path, r.title);
    }
  }
  return { externals, analysisByExternalId, ourTitles };
}
