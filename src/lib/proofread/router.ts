import {
  listModels,
  getDefaultModelKey,
  getPrompt,
  getDefaultMode,
  getUserConfig,
  getKorektorConfig,
} from "./store";
import type {
  KorektorConfig,
  ProofreadModel,
  ProofreadPrompt,
} from "./types";

export class ProofreadConfigError extends Error {}

export interface ResolvedConfig {
  model: ProofreadModel;
  prompt: ProofreadPrompt;
  mode: string;
  korektor: KorektorConfig;
}

/**
 * Resolve which model + prompt to use for a request.
 * Mode: requested-if-valid, else the system default mode.
 * Model: per-user model_key (if set & enabled), else system default, else first enabled.
 * Prompt: per-user prompt_override (if set), else the system prompt for the mode.
 */
export async function resolveConfig(
  email: string,
  requestedMode?: string
): Promise<ResolvedConfig> {
  const [models, userCfg, korektor] = await Promise.all([
    listModels(),
    getUserConfig(email),
    getKorektorConfig(),
  ]);
  const enabled = models.filter((m) => m.enabled);
  if (enabled.length === 0) {
    throw new ProofreadConfigError("Není nakonfigurován žádný model.");
  }

  // Mode + base prompt.
  let mode = requestedMode?.trim() || "";
  let prompt = mode ? await getPrompt(mode) : null;
  if (!prompt) {
    const defaultMode = await getDefaultMode();
    mode = defaultMode ?? "";
    prompt = mode ? await getPrompt(mode) : null;
  }
  if (!prompt) {
    throw new ProofreadConfigError("Není nakonfigurován žádný prompt.");
  }

  // Model.
  let model: ProofreadModel | undefined;
  if (userCfg?.modelKey) {
    model = enabled.find((m) => m.key === userCfg.modelKey);
  }
  if (!model) {
    const defaultKey = await getDefaultModelKey();
    if (defaultKey) model = enabled.find((m) => m.key === defaultKey);
  }
  if (!model) model = enabled[0];

  // Per-user prompt override.
  if (userCfg?.promptOverride && userCfg.promptOverride.trim()) {
    prompt = { ...prompt, body: userCfg.promptOverride.trim() };
  }

  return { model, prompt, mode, korektor };
}
