import OpenAI from "openai";
import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { AiTopicResult, buildClusteringPrompt, buildTopicsFromAiResult } from "./ai-shared";

export class OpenAiClustering implements ClusteringStrategy {
  private client: OpenAI;
  private excludeWords: string[];

  constructor(apiKey: string, excludeWords: string[] = []) {
    this.client = new OpenAI({ apiKey });
    this.excludeWords = excludeWords;
  }

  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    try {
      const prompt = buildClusteringPrompt(articles, this.excludeWords);

      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });

      const text = response.choices[0]?.message?.content ?? "";
      const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const aiTopics: AiTopicResult[] = JSON.parse(jsonStr);

      return buildTopicsFromAiResult(aiTopics, articles);
    } catch (error) {
      console.error("OpenAI clustering failed, falling back to keyword clustering:", error);
      const { KeywordClustering } = await import("./keyword-clustering");
      return new KeywordClustering(this.excludeWords).cluster(articles);
    }
  }
}
