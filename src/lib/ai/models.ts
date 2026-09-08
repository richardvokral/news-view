// Shared reader over the app's AI model catalog.
//
// The catalog physically lives in `proofread_models` because proofreading was
// the first feature to need one. It is app-wide in practice — /insights picks
// its model from the same list — so read it through here rather than importing
// the proofread store directly, and treat the table name as an implementation
// detail rather than a statement about ownership.

export {
  listModels as listAiModels,
  getModel as getAiModel,
} from "@/lib/proofread/store";
export { estimateCost } from "@/lib/proofread/usage";
export type { ProofreadModel as AiModel, Provider } from "@/lib/proofread/types";
