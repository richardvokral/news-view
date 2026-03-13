import { NormalizedArticle, Topic } from "../fetchers/types";

export interface ClusteringStrategy {
  cluster(articles: NormalizedArticle[]): Promise<Topic[]>;
}
