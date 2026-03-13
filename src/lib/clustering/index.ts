import { ApiConfig } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { KeywordClustering } from "./keyword-clustering";
import { AiClustering } from "./ai-clustering";

export function getClusteringStrategy(config: ApiConfig): ClusteringStrategy {
  if (config.clustering.mode === "ai" && config.clustering.anthropicApiKey) {
    return new AiClustering(config.clustering.anthropicApiKey, config.excludeWords || []);
  }
  return new KeywordClustering(config.excludeWords || []);
}
