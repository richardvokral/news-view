import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { KeywordClustering } from "./keyword-clustering";
import { hashId } from "../fetchers/utils";

interface HybridClusterSummary {
  idx: number;
  name: string;
  keywords: string[];
  titles: string[];
  articleCount: number;
  countries: string[];
  category: string | null;
}

interface AiRefinedTopic {
  idx: number;
  name: string;
  category: string | null;
  urgency: number;
  mergeWith?: number[];
}

export class HybridClustering implements ClusteringStrategy {
  private provider: "anthropic" | "openai";
  private apiKey: string;
  private excludeWords: string[];

  constructor(
    provider: "anthropic" | "openai",
    apiKey: string,
    excludeWords: string[] = []
  ) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.excludeWords = excludeWords;
  }

  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    const keywordClustering = new KeywordClustering(this.excludeWords);
    const rawTopics = await keywordClustering.cluster(articles);

    if (rawTopics.length === 0) return [];

    try {
      const refined = await this.refineWithAi(rawTopics);
      return refined;
    } catch (error) {
      console.error("Hybrid AI refinement failed, using keyword results:", error);
      return rawTopics;
    }
  }

  private async refineWithAi(topics: Topic[]): Promise<Topic[]> {
    const summaries: HybridClusterSummary[] = topics.map((t, idx) => ({
      idx,
      name: t.name,
      keywords: t.keywords,
      titles: t.articles.slice(0, 5).map((a) => a.title),
      articleCount: t.totalArticles,
      countries: [
        t.countByCountry.us > 0 ? `US:${t.countByCountry.us}` : "",
        t.countByCountry.de > 0 ? `DE:${t.countByCountry.de}` : "",
      ].filter(Boolean),
      category: t.category,
    }));

    const prompt = `You are a senior news editor. I have ${topics.length} topic clusters from a news aggregator covering US and German news. Each cluster was grouped by keyword similarity. Your job:

1. Give each topic a clear, newsroom-quality English headline (3-7 words)
2. If any titles are in German, use the meaning to inform the English topic name
3. Assign a category: world, politics, business, technology, science, health, sports, entertainment, environment, or null
4. Assign urgency 1-5 (1=routine, 3=notable, 5=breaking)
5. If two clusters are about the same story, mark them for merging

Clusters:
${JSON.stringify(summaries, null, 0)}

Return a JSON array. Each item:
- "idx": the cluster index
- "name": English headline for the topic
- "category": category string or null
- "urgency": 1-5
- "mergeWith": optional array of other idx values this should merge with

Respond ONLY with the JSON array.`;

    let text: string;

    if (this.provider === "anthropic") {
      const client = new Anthropic({ apiKey: this.apiKey });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      text = response.content[0].type === "text" ? response.content[0].text : "";
    } else {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      text = response.choices[0]?.message?.content ?? "";
    }

    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const refined: AiRefinedTopic[] = JSON.parse(jsonStr);

    return this.applyRefinements(topics, refined);
  }

  private applyRefinements(topics: Topic[], refined: AiRefinedTopic[]): Topic[] {
    const refinedMap = new Map(refined.map((r) => [r.idx, r]));
    const mergedInto = new Set<number>();

    for (const r of refined) {
      if (r.mergeWith) {
        for (const target of r.mergeWith) {
          if (target !== r.idx) mergedInto.add(target);
        }
      }
    }

    const result: Topic[] = [];

    for (let i = 0; i < topics.length; i++) {
      if (mergedInto.has(i)) continue;

      const r = refinedMap.get(i);
      let topic = topics[i];

      if (r?.mergeWith) {
        for (const mergeIdx of r.mergeWith) {
          if (mergeIdx >= 0 && mergeIdx < topics.length && mergeIdx !== i) {
            const other = topics[mergeIdx];
            topic = {
              ...topic,
              articles: [...topic.articles, ...other.articles],
              totalArticles: topic.totalArticles + other.totalArticles,
              countByCountry: {
                us: topic.countByCountry.us + other.countByCountry.us,
                de: topic.countByCountry.de + other.countByCountry.de,
              },
              keywords: [...new Set([...topic.keywords, ...other.keywords])].slice(0, 5),
            };
          }
        }
      }

      if (r) {
        topic = {
          ...topic,
          id: hashId(r.name),
          name: r.name,
          category: r.category,
          urgency: Math.max(1, Math.min(5, r.urgency)),
        };
      }

      result.push(topic);
    }

    result.sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
      return b.totalArticles - a.totalArticles;
    });

    return result;
  }
}
