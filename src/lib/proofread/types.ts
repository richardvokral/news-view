export type Provider = "openai" | "anthropic";

export interface ProofreadModel {
  key: string;
  provider: Provider;
  modelId: string;
  label: string;
  enabled: boolean;
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  sortOrder: number;
}

export interface ProofreadPrompt {
  mode: string;
  label: string;
  body: string;
  isDefaultMode: boolean;
}

export interface ProofreadUserConfig {
  email: string;
  modelKey: string | null;
  promptOverride: string | null;
}

export interface Suggestion {
  id?: string;
  field: "title" | "body";
  type: string;
  original: string;
  replacement: string;
  explanation: string;
  confidence: number;
}

export interface ProofreadResult {
  title: string | null;
  bodyHtml: string | null;
  suggestions: Suggestion[];
  summary: string;
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface ProofreadUserPayload {
  mode: string;
  title: string | null;
  bodyHtml: string | null;
}
