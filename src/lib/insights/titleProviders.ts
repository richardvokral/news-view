import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  buildTitleAnalysisSystemMessage,
  buildTitleAnalysisUserMessage,
  buildRewriteSystemMessage,
  buildRewriteUserMessage,
  type CohortArticle,
  type RewriteInput,
} from "./titlePrompts";

export interface ProviderCall {
  modelId: string;
  apiKey: string;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
}

// --- Title analysis ---------------------------------------------------------

export interface RawTitleAnalysis {
  patterns: {
    label: string;
    cohort: "vitezove" | "propadaky";
    form_note: string;
    article_indexes: number[];
  }[];
  contrast_note: string;
  playbook_draft: string;
  notes?: string[];
}

const PATTERN_PROPS = {
  label: { type: "string", description: "Název vzoru, 2-5 slov." },
  cohort: {
    type: "string",
    enum: ["vitezove", "propadaky"],
    description: "Ve které skupině vzor převažuje.",
  },
  form_note: { type: "string", description: "Čím se forma vyznačuje. Bez čísel." },
  article_indexes: { type: "array", items: { type: "integer" } },
} as const;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "submit_title_analysis",
  description: "Odešli rozbor vzorů v titulcích.",
  input_schema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: PATTERN_PROPS,
          required: ["label", "cohort", "form_note", "article_indexes"],
        },
      },
      contrast_note: {
        type: "string",
        description: "Rozdíl mezi normalizovanými a absolutními skupinami.",
      },
      playbook_draft: {
        type: "string",
        description: "Český návod pro psaní titulků, pravidla po řádcích.",
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["patterns", "contrast_note", "playbook_draft"],
  },
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: PATTERN_PROPS,
        required: ["label", "cohort", "form_note", "article_indexes"],
      },
    },
    contrast_note: { type: "string" },
    playbook_draft: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["patterns", "contrast_note", "playbook_draft", "notes"],
} as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function idxArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0)
    : [];
}

function normalizeAnalysis(input: unknown): RawTitleAnalysis {
  const o = (input ?? {}) as Record<string, unknown>;
  const patterns = Array.isArray(o.patterns)
    ? o.patterns.map((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        return {
          label: str(r.label) || "Bez názvu",
          cohort: r.cohort === "propadaky" ? ("propadaky" as const) : ("vitezove" as const),
          form_note: str(r.form_note),
          article_indexes: idxArray(r.article_indexes),
        };
      })
    : [];
  return {
    patterns,
    contrast_note: str(o.contrast_note),
    playbook_draft: str(o.playbook_draft),
    notes: strArray(o.notes),
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

function stripFences(text: string): string {
  return text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
}

export async function runTitleAnalysisCall(
  call: ProviderCall & {
    provider: "anthropic" | "openai";
    promptBody: string;
    articles: CohortArticle[];
    scopeLabel: string;
  }
): Promise<{ raw: RawTitleAnalysis } & CallUsage> {
  const system = buildTitleAnalysisSystemMessage(call.promptBody);
  const user = buildTitleAnalysisUserMessage(call.articles, call.scopeLabel);

  if (call.provider === "anthropic") {
    const client = new Anthropic({ apiKey: call.apiKey });
    const response = await client.messages.create({
      model: call.modelId,
      max_tokens: 8192,
      system,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "submit_title_analysis" },
      messages: [{ role: "user", content: user }],
    });
    let input: unknown = {};
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_title_analysis") {
        input = block.input;
        break;
      }
    }
    return {
      raw: normalizeAnalysis(input),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  const client = new OpenAI({ apiKey: call.apiKey });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const create = (
    responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["response_format"]
  ) =>
    client.chat.completions.create({
      model: call.modelId,
      max_completion_tokens: 8192,
      response_format: responseFormat,
      messages,
    });

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await create({
      type: "json_schema",
      json_schema: { name: "title_analysis", strict: true, schema: ANALYSIS_SCHEMA },
    });
  } catch (e) {
    if (!isResponseFormatError(e)) throw e;
    response = await create({ type: "json_object" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(response.choices[0]?.message?.content ?? ""));
  } catch {
    throw new Error("Model nevrátil platný JSON.");
  }
  return {
    raw: normalizeAnalysis(parsed),
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

// --- Rewriter ---------------------------------------------------------------

export interface RawRewrite {
  critique: string;
  broken_rules: string[];
  variants: {
    title: string;
    rule_ids: number[];
    rationale: string;
  }[];
  notes?: string[];
}

const VARIANT_PROPS = {
  title: { type: "string", description: "Přepsaný titulek v češtině s diakritikou." },
  rule_ids: {
    type: "array",
    items: { type: "integer" },
    description:
      "Id pravidel ze značky <playbook>, která varianta uplatňuje. Nikdy neuváděj id, které v playbooku není.",
  },
  rationale: {
    type: "string",
    description: "Proč je varianta řemeslně lepší. ŽÁDNÁ čísla ani předpovědi výkonu.",
  },
} as const;

const REWRITE_TOOL: Anthropic.Tool = {
  name: "submit_title_rewrite",
  description: "Odešli rozbor a přepsané varianty titulku.",
  input_schema: {
    type: "object",
    properties: {
      critique: {
        type: "string",
        description: "Co je na původním titulku slabé. Bez čísel.",
      },
      broken_rules: { type: "array", items: { type: "string" } },
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: VARIANT_PROPS,
          required: ["title", "rule_ids", "rationale"],
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["critique", "broken_rules", "variants"],
  },
};

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    critique: { type: "string" },
    broken_rules: { type: "array", items: { type: "string" } },
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: VARIANT_PROPS,
        required: ["title", "rule_ids", "rationale"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["critique", "broken_rules", "variants", "notes"],
} as const;

function normalizeRewrite(input: unknown): RawRewrite {
  const o = (input ?? {}) as Record<string, unknown>;
  const variants = Array.isArray(o.variants)
    ? o.variants
        .map((v) => {
          const r = (v ?? {}) as Record<string, unknown>;
          return {
            title: str(r.title),
            rule_ids: idxArray(r.rule_ids),
            rationale: str(r.rationale),
          };
        })
        .filter((v) => v.title)
    : [];
  return {
    critique: str(o.critique),
    broken_rules: strArray(o.broken_rules),
    variants,
    notes: strArray(o.notes),
  };
}

export async function runRewriteCall(
  call: ProviderCall & {
    provider: "anthropic" | "openai";
    rules: string[];
    input: RewriteInput;
  }
): Promise<{ raw: RawRewrite } & CallUsage> {
  const system = buildRewriteSystemMessage();
  const user = buildRewriteUserMessage(call.input, call.rules);

  if (call.provider === "anthropic") {
    const client = new Anthropic({ apiKey: call.apiKey });
    const response = await client.messages.create({
      model: call.modelId,
      max_tokens: 2048,
      system,
      tools: [REWRITE_TOOL],
      tool_choice: { type: "tool", name: "submit_title_rewrite" },
      messages: [{ role: "user", content: user }],
    });
    let input: unknown = {};
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_title_rewrite") {
        input = block.input;
        break;
      }
    }
    return {
      raw: normalizeRewrite(input),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  const client = new OpenAI({ apiKey: call.apiKey });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const create = (
    responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["response_format"]
  ) =>
    client.chat.completions.create({
      model: call.modelId,
      max_completion_tokens: 2048,
      response_format: responseFormat,
      messages,
    });

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await create({
      type: "json_schema",
      json_schema: { name: "title_rewrite", strict: true, schema: REWRITE_SCHEMA },
    });
  } catch (e) {
    if (!isResponseFormatError(e)) throw e;
    response = await create({ type: "json_object" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(response.choices[0]?.message?.content ?? ""));
  } catch {
    throw new Error("Model nevrátil platný JSON.");
  }
  return {
    raw: normalizeRewrite(parsed),
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}
