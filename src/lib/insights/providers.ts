import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { buildInsightsSystemMessage, buildInsightsUserMessage } from "./prompts";
import type { AggregatedArticle } from "./types";

/**
 * What the model is allowed to return: prose plus article indexes. No counts,
 * no sums, no percentages — the server derives all of those from the rows.
 */
export interface RawThemeOutput {
  themes: {
    name: string;
    summary: string;
    article_indexes: number[];
    why_it_worked: string;
    editorial_sections?: string[];
  }[];
  headline_patterns?: {
    label: string;
    note: string;
    article_indexes: number[];
  }[];
  overall_narrative: string;
  recommendations: string[];
  notes?: string[];
}

export interface AnalysisCallOpts {
  modelId: string;
  promptBody: string;
  articles: AggregatedArticle[];
  scopeLabel: string;
  apiKey: string;
}

export interface AnalysisCallResult {
  raw: RawThemeOutput;
  inputTokens: number;
  outputTokens: number;
}

const THEME_PROPS = {
  name: { type: "string", description: "2-5 slov, česky." },
  summary: { type: "string", description: "1-2 věty. ŽÁDNÁ čísla." },
  article_indexes: {
    type: "array",
    items: { type: "integer" },
    description: "Hodnoty idx ze seznamu. Každý článek nejvýše v jednom tématu.",
  },
  why_it_worked: { type: "string", description: "Proč téma čtenáře zaujalo. Bez čísel." },
  editorial_sections: { type: "array", items: { type: "string" } },
} as const;

const PATTERN_PROPS = {
  label: { type: "string", description: "Např. 'Jméno osoby v titulku'." },
  note: { type: "string", description: "Krátké vysvětlení. Bez čísel." },
  article_indexes: { type: "array", items: { type: "integer" } },
} as const;

const TOOL: Anthropic.Tool = {
  name: "submit_theme_analysis",
  description: "Odešli tematickou analýzu nejčtenějších článků.",
  input_schema: {
    type: "object",
    properties: {
      themes: {
        type: "array",
        items: {
          type: "object",
          properties: THEME_PROPS,
          required: ["name", "summary", "article_indexes", "why_it_worked"],
        },
      },
      headline_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: PATTERN_PROPS,
          required: ["label", "note", "article_indexes"],
        },
      },
      overall_narrative: { type: "string" },
      recommendations: { type: "array", items: { type: "string" } },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["themes", "overall_narrative", "recommendations"],
  },
};

// OpenAI strict mode: additionalProperties:false everywhere, every property in
// `required`. It also rejects minItems/maxItems, so bounds live in the prompt
// and are enforced server-side.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: THEME_PROPS,
        required: [
          "name",
          "summary",
          "article_indexes",
          "why_it_worked",
          "editorial_sections",
        ],
      },
    },
    headline_patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: PATTERN_PROPS,
        required: ["label", "note", "article_indexes"],
      },
    },
    overall_narrative: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "themes",
    "headline_patterns",
    "overall_narrative",
    "recommendations",
    "notes",
  ],
} as const;

function normalizeRaw(input: unknown): RawThemeOutput {
  const obj = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const idxArray = (v: unknown): number[] =>
    Array.isArray(v)
      ? v
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n >= 0)
      : [];

  const themes = Array.isArray(obj.themes)
    ? obj.themes.map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return {
          name: str(o.name) || "Bez názvu",
          summary: str(o.summary),
          article_indexes: idxArray(o.article_indexes),
          why_it_worked: str(o.why_it_worked),
          editorial_sections: strArray(o.editorial_sections),
        };
      })
    : [];

  const patterns = Array.isArray(obj.headline_patterns)
    ? obj.headline_patterns.map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        return {
          label: str(o.label) || "Bez názvu",
          note: str(o.note),
          article_indexes: idxArray(o.article_indexes),
        };
      })
    : [];

  return {
    themes,
    headline_patterns: patterns,
    overall_narrative: str(obj.overall_narrative),
    recommendations: strArray(obj.recommendations),
    notes: strArray(obj.notes),
  };
}

export async function runAnthropicAnalysis(
  opts: AnalysisCallOpts
): Promise<AnalysisCallResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const response = await client.messages.create({
    model: opts.modelId,
    max_tokens: 8192,
    system: buildInsightsSystemMessage(opts.promptBody),
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_theme_analysis" },
    messages: [
      {
        role: "user",
        content: buildInsightsUserMessage(opts.articles, opts.scopeLabel),
      },
    ],
  });

  let input: unknown = {};
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "submit_theme_analysis") {
      input = block.input;
      break;
    }
  }
  return {
    raw: normalizeRaw(input),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function isResponseFormatError(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  const msg = String((e as { message?: string }).message ?? "").toLowerCase();
  return (
    status === 400 &&
    (msg.includes("response_format") ||
      msg.includes("json_schema") ||
      msg.includes("schema") ||
      msg.includes("structured"))
  );
}

export async function runOpenAiAnalysis(
  opts: AnalysisCallOpts
): Promise<AnalysisCallResult> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const messages = [
    { role: "system" as const, content: buildInsightsSystemMessage(opts.promptBody) },
    {
      role: "user" as const,
      content: buildInsightsUserMessage(opts.articles, opts.scopeLabel),
    },
  ];

  // max_completion_tokens, and no temperature: gpt-5/o-series reject both the
  // legacy field and a custom temperature.
  const create = (responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["response_format"]) =>
    client.chat.completions.create({
      model: opts.modelId,
      max_completion_tokens: 8192,
      response_format: responseFormat,
      messages,
    });

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await create({
      type: "json_schema",
      json_schema: { name: "theme_analysis", strict: true, schema: SCHEMA },
    });
  } catch (e) {
    if (!isResponseFormatError(e)) throw e;
    response = await create({ type: "json_object" });
  }

  const text = (response.choices[0]?.message?.content ?? "")
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model nevrátil platný JSON.");
  }

  return {
    raw: normalizeRaw(parsed),
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}
