import Anthropic from "@anthropic-ai/sdk";
import type { ProofreadResult } from "./types";
import type { ProviderCallOpts } from "./openai";
import { buildSystemMessage, buildUserMessage } from "./prompts";
import { normalizeResult } from "./parse";

const TOOL: Anthropic.Tool = {
  name: "submit_proofread",
  description: "Odešli opravený text a strukturovaný seznam změn.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Opravený titulek; vynech, pokud titulek nebyl zadán.",
      },
      bodyHtml: {
        type: "string",
        description:
          "Kompletní opravené HTML těla; vynech, pokud tělo nebylo zadáno.",
      },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: ["title", "body"] },
            type: { type: "string" },
            original: { type: "string" },
            replacement: { type: "string" },
            explanation: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["field", "original", "replacement"],
        },
      },
      summary: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["suggestions", "summary"],
  },
};

export async function runAnthropic(
  opts: ProviderCallOpts
): Promise<ProofreadResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const response = await client.messages.create({
    model: opts.modelId,
    max_tokens: 8192,
    system: buildSystemMessage(opts.promptBody),
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_proofread" },
    messages: [{ role: "user", content: buildUserMessage(opts.payload) }],
  });

  let input: unknown = {};
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "submit_proofread") {
      input = block.input;
      break;
    }
  }
  return normalizeResult(
    input,
    response.usage.input_tokens,
    response.usage.output_tokens
  );
}
