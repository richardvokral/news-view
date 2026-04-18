import Anthropic from "@anthropic-ai/sdk";
import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { hashId } from "../fetchers/utils";
import { buildTopicsFromAiResult, AiTopicResult, buildClusteringPrompt } from "./ai-shared";

const BATCH_SIZE = 50;

export class AiClustering implements ClusteringStrategy {
  private client: Anthropic;
  private excludeWords: string[];

  constructor(apiKey: string, excludeWords: string[] = []) {
    this.client = new Anthropic({ apiKey });
    this.excludeWords = excludeWords;
  }

  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    try {
      if (articles.length <= BATCH_SIZE) {
        return await this.clusterBatch(articles);
      }

      const batches: NormalizedArticle[][] = [];
      for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        batches.push(articles.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(
        batches.map((batch) => this.clusterBatch(batch))
      );

      return mergeTopics(batchResults.flat());
    } catch (error) {
      console.error("AI clustering failed, falling back to keyword clustering:", error);
      const { KeywordClustering } = await import("./keyword-clustering");
      return new KeywordClustering(this.excludeWords).cluster(articles);
    }
  }

  private async clusterBatch(articles: NormalizedArticle[]): Promise<Topic[]> {
    const prompt = buildClusteringPrompt(articles, this.excludeWords);

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const aiTopics: AiTopicResult[] = JSON.parse(jsonStr);

    return buildTopicsFromAiResult(aiTopics, articles);
  }
}

function mergeTopics(topics: Topic[]): Topic[] {
  const merged: Topic[] = [];
  const used = new Set<number>();

  for (let i = 0; i < topics.length; i++) {
    if (used.has(i)) continue;

    let current = topics[i];
    const currentArticleIds = new Set(current.articles.map((a) => a.id));

    for (let j = i + 1; j < topics.length; j++) {
      if (used.has(j)) continue;

      const other = topics[j];
      const overlap = other.articles.filter((a) => currentArticleIds.has(a.id)).length;
      const nameMatch =
        current.name.toLowerCase().includes(other.name.toLowerCase()) ||
        other.name.toLowerCase().includes(current.name.toLowerCase());

      if (overlap > 0 || nameMatch) {
        used.add(j);
        for (const a of other.articles) {
          if (!currentArticleIds.has(a.id)) {
            currentArticleIds.add(a.id);
            current.articles.push(a);
          }
        }
        current = {
          ...current,
          totalArticles: current.articles.length,
          countByCountry: {
            us: current.articles.filter((a) => a.sourceCountry === "us").length,
            de: current.articles.filter((a) => a.sourceCountry === "de").length,
          },
          urgency: Math.max(current.urgency, other.urgency),
        };
      }
    }

    merged.push(current);
  }

  merged.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
    return b.totalArticles - a.totalArticles;
  });

  return merged;
}
