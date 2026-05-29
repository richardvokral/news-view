import type { Suggestion } from "./types";

export interface KorektorResult {
  suggestions: Suggestion[];
  acknowledgements: string[];
  inputChars: number;
}

const TIMEOUT_MS = 30_000;

// Korektor doesn't understand HTML — strip tags to plain text before sending.
// The resulting word tokens still match verbatim inside the original HTML
// (the extension does a string search), and unmatched ones are flagged in the
// UI as "nelze najít v textu", so a token that spans a tag boundary just
// degrades gracefully instead of corrupting markup.
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface KorektorApiResponse {
  model?: string;
  acknowledgements?: string[];
  result?: unknown;
}

// Call the Korektor /suggestions endpoint for one piece of text and turn its
// token-chunk response into our Suggestion[] shape. A chunk of length 1 is
// unchanged passthrough; length >= 2 is [original, alt1, alt2, ...].
async function correctText(
  endpoint: string,
  model: string,
  field: "title" | "body",
  text: string
): Promise<{ suggestions: Suggestion[]; acknowledgements: string[] }> {
  if (!text.trim()) return { suggestions: [], acknowledgements: [] };

  const form = new FormData();
  form.append("data", text);
  form.append("model", model);
  form.append("suggestions", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let json: KorektorApiResponse;
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/suggestions`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Korektor HTTP ${res.status}`);
    json = (await res.json()) as KorektorApiResponse;
  } finally {
    clearTimeout(timer);
  }

  const suggestions: Suggestion[] = [];
  if (Array.isArray(json.result)) {
    for (const chunk of json.result) {
      if (!Array.isArray(chunk) || chunk.length < 2) continue;
      const original = typeof chunk[0] === "string" ? chunk[0] : "";
      const replacement = typeof chunk[1] === "string" ? chunk[1] : "";
      if (!original || !replacement || original === replacement) continue;
      suggestions.push({
        field,
        type: "pravopis (K)",
        original,
        replacement,
        explanation: "Korektor (ÚFAL)",
        confidence: 0.9,
      });
    }
  }
  const acknowledgements = Array.isArray(json.acknowledgements)
    ? json.acknowledgements.filter((a): a is string => typeof a === "string")
    : [];
  return { suggestions, acknowledgements };
}

/**
 * Run Korektor over the title and/or body. Never throws on a remote failure —
 * the caller treats an empty result as "Korektor unavailable" and proceeds
 * with the LLM alone.
 */
export async function runKorektor(opts: {
  endpoint: string;
  model: string;
  title: string | null;
  bodyHtml: string | null;
}): Promise<KorektorResult> {
  const inputChars =
    (opts.title?.length ?? 0) + (opts.bodyHtml?.length ?? 0);
  const tasks: Promise<{
    suggestions: Suggestion[];
    acknowledgements: string[];
  }>[] = [];
  if (opts.title) {
    tasks.push(correctText(opts.endpoint, opts.model, "title", opts.title));
  }
  if (opts.bodyHtml) {
    tasks.push(
      correctText(opts.endpoint, opts.model, "body", htmlToText(opts.bodyHtml))
    );
  }
  const parts = await Promise.all(tasks);
  const suggestions = parts.flatMap((p) => p.suggestions);
  const acknowledgements = Array.from(
    new Set(parts.flatMap((p) => p.acknowledgements))
  );
  return { suggestions, acknowledgements, inputChars };
}

/** Merge Korektor suggestions ahead of the LLM's, dropping LLM duplicates
 *  that target an overlapping span on the same field (Korektor wins on tie). */
export function mergeSuggestions(
  korektor: Suggestion[],
  llm: Suggestion[]
): Suggestion[] {
  const overlaps = (a: Suggestion, b: Suggestion) =>
    a.field === b.field &&
    (a.original === b.original ||
      a.original.includes(b.original) ||
      b.original.includes(a.original));
  const merged = [...korektor];
  for (const s of llm) {
    if (!korektor.some((k) => overlaps(k, s))) merged.push(s);
  }
  return merged.map((s, i) => ({ ...s, id: `s${i}` }));
}
