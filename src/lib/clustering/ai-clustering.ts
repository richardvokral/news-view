import Anthropic from "@anthropic-ai/sdk";
import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { hashId } from "../fetchers/utils";

interface AiTopicResult {
  name: string;
  category: string | null;
  articleIds: string[];
}

export class AiClustering implements ClusteringStrategy {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    // Build a compact representation for the prompt
    const articleList = articles.map((a) => ({
      id: a.id,
      title: a.title,
      country: a.sourceCountry,
      source: a.source,
      date: a.publishedAt,
      category: a.category,
    }));

    const prompt = `You are a news editor's assistant. Group these ${articles.length} news articles into topics based on what they're about.

Articles:
${JSON.stringify(articleList, null, 0)}

Return a JSON array of topics. Each topic should have:
- "name": A short, clear topic name (2-5 words, e.g. "Ukraine Peace Talks", "Tesla Stock Surge")
- "category": One of: world, politics, business, technology, science, health, sports, entertainment, environment, or null
- "articleIds": Array of article IDs that belong to this topic

Group articles that cover the same story or event. Single articles with no related stories should still get their own topic. Respond ONLY with the JSON array, no other text.`;

    try {
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Parse the JSON response - handle potential markdown code blocks
      const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const aiTopics: AiTopicResult[] = JSON.parse(jsonStr);

      return this.buildTopics(aiTopics, articles);
    } catch (error) {
      console.error("AI clustering failed, falling back to keyword clustering:", error);
      // Dynamically import to avoid circular dependency
      const { KeywordClustering } = await import("./keyword-clustering");
      return new KeywordClustering().cluster(articles);
    }
  }

  private buildTopics(
    aiTopics: AiTopicResult[],
    articles: NormalizedArticle[]
  ): Topic[] {
    const articleMap = new Map(articles.map((a) => [a.id, a]));
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const topics: Topic[] = [];

    for (const aiTopic of aiTopics) {
      const topicArticles = aiTopic.articleIds
        .map((id) => articleMap.get(id))
        .filter((a): a is NormalizedArticle => a !== undefined);

      if (topicArticles.length === 0) continue;

      const usCount = topicArticles.filter((a) => a.sourceCountry === "us").length;
      const deCount = topicArticles.filter((a) => a.sourceCountry === "de").length;

      const latestPublishedAt = topicArticles.reduce(
        (latest, a) => (a.publishedAt > latest ? a.publishedAt : latest),
        topicArticles[0].publishedAt
      );

      const recentCount = topicArticles.filter(
        (a) => new Date(a.publishedAt).getTime() > twoHoursAgo
      ).length;
      const dayCount = topicArticles.filter(
        (a) => new Date(a.publishedAt).getTime() > oneDayAgo
      ).length;
      const trendScore = dayCount > 0 ? recentCount / dayCount : 0;

      // Extract keywords from article keywords
      const keywordCounts = new Map<string, number>();
      for (const a of topicArticles) {
        for (const kw of a.keywords) {
          keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
        }
      }
      const topKeywords = [...keywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kw]) => kw);

      topics.push({
        id: hashId(aiTopic.name),
        name: aiTopic.name,
        keywords: topKeywords,
        articles: topicArticles,
        countByCountry: { us: usCount, de: deCount },
        totalArticles: topicArticles.length,
        latestPublishedAt,
        trendScore,
        category: aiTopic.category,
      });
    }

    topics.sort((a, b) => {
      if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
      return b.totalArticles - a.totalArticles;
    });

    return topics;
  }
}
