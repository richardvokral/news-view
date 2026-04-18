import { ApiConfig } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { KeywordClustering } from "./keyword-clustering";
import { AiClustering } from "./ai-clustering";
import { OpenAiClustering } from "./openai-clustering";

export function getClusteringStrategy(config: ApiConfig): ClusteringStrategy {
  const excludeWords = config.excludeWords || [];

  if (config.clustering.mode === "ai" && config.clustering.anthropicApiKey) {
    return new AiClustering(config.clustering.anthropicApiKey, excludeWords);
  }
  if (config.clustering.mode === "ai-openai" && config.clustering.openaiApiKey) {
    return new OpenAiClustering(config.clustering.openaiApiKey, excludeWords);
  }
  return new KeywordClustering(excludeWords);
}
