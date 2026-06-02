import OpenAI from "openai";
import type { ProofreadResult, ProofreadUserPayload } from "./types";
import { buildSystemMessage, buildUserMessage } from "./prompts";
import { normalizeResult } from "./parse";

export interface ProviderCallOpts {
  modelId: string;
  promptBody: string;
  payload: ProofreadUserPayload;
  apiKey: string;
  /** Extra system text appended after the contract (e.g. Korektor hint). */
  systemSuffix?: string;
}

// Strict JSON Schema for Structured Outputs. strict mode requires every
// property to be listed in `required` and `additionalProperties: false` on
// every object — the API then rejects any response that doesn't match, which
// removes a whole class of malformed outputs (e.g. fixes lumped into summary).
const PROOFREAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: ["title", "body"] },
          type: { type: "string" },
          original: { type: "string" },
          replacement: { type: "string" },
          explanation: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "field",
          "type",
          "original",
          "replacement",
          "explanation",
          "confidence",
        ],
      },
    },
    summary: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["suggestions", "summary", "warnings"],
} as const;

// Some older / niche models reject Structured Outputs. Detect that specific
// 400 so we can transparently fall back to plain json_object mode.
function isResponseFormatError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
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

export async function runOpenAI(
  opts: ProviderCallOpts
): Promise<ProofreadResult> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemMessage(opts.promptBody) + (opts.systemSuffix ?? ""),
    },
    { role: "user", content: buildUserMessage(opts.payload) },
  ];

  // Note: no `temperature` — newer models (gpt-5.x, o-series) only accept the
  // default and reject any custom value.
  const create = (
    responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
  ) =>
    client.chat.completions.create({
      model: opts.modelId,
      max_completion_tokens: 8192,
      response_format: responseFormat,
      messages,
    });

  let response;
  try {
    response = await create({
      type: "json_schema",
      json_schema: { name: "proofread", strict: true, schema: PROOFREAD_SCHEMA },
    });
  } catch (e) {
    if (!isResponseFormatError(e)) throw e;
    response = await create({ type: "json_object" });
  }

  const text = response.choices[0]?.message?.content ?? "";
  const jsonStr = text
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(jsonStr || "{}");
  } catch {
    throw new Error("Model nevrátil platný JSON.");
  }
  return normalizeResult(
    parsed,
    response.usage?.prompt_tokens ?? 0,
    response.usage?.completion_tokens ?? 0
  );
}
