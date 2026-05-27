import OpenAI from "openai";
import type { ProofreadResult, ProofreadUserPayload } from "./types";
import { buildSystemMessage, buildUserMessage } from "./prompts";
import { normalizeResult } from "./parse";

export interface ProviderCallOpts {
  modelId: string;
  promptBody: string;
  payload: ProofreadUserPayload;
  apiKey: string;
}

export async function runOpenAI(
  opts: ProviderCallOpts
): Promise<ProofreadResult> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const response = await client.chat.completions.create({
    model: opts.modelId,
    max_tokens: 8192,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemMessage(opts.promptBody) },
      { role: "user", content: buildUserMessage(opts.payload) },
    ],
  });
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
