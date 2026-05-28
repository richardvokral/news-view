import type { ProofreadResult, Suggestion } from "./types";

function normalizeSuggestion(raw: unknown): Suggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const original = typeof o.original === "string" ? o.original : "";
  const replacement = typeof o.replacement === "string" ? o.replacement : "";
  if (!original && !replacement) return null;
  const confidence =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.max(0, Math.min(1, o.confidence))
      : 0.8;
  return {
    field: o.field === "title" ? "title" : "body",
    type: typeof o.type === "string" && o.type ? o.type : "oprava",
    original,
    replacement,
    explanation: typeof o.explanation === "string" ? o.explanation : "",
    confidence,
  };
}

/** Coerce an arbitrary LLM JSON object into a safe ProofreadResult. */
export function normalizeResult(
  raw: unknown,
  inputTokens: number,
  outputTokens: number
): ProofreadResult {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions
        .map(normalizeSuggestion)
        .filter((s): s is Suggestion => s !== null)
        .map((s, i) => ({ ...s, id: `s${i}` }))
    : [];
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((w): w is string => typeof w === "string")
      : [],
    suggestions,
    inputTokens,
    outputTokens,
  };
}
