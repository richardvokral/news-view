import Anthropic from "@anthropic-ai/sdk";
import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { hashId } from "../fetchers/utils";

interface AiTopicResult {
  name: string;
  category: string | null;
  urgency: number;
  articleIds: string[];
}

export class AiClustering implements ClusteringStrategy {
  private client: Anthropic;
  private excludeWords: string[];

  constructor(apiKey: string, excludeWords: string[] = []) {
    this.client = new Anthropic({ apiKey });
    this.excludeWords = excludeWords;
  }

  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    // Include summaries for better clustering context
    const articleList = articles.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary?.slice(0, 100) || "",
      country: a.sourceCountry,
      source: a.source,
      date: a.publishedAt,
      category: a.category,
    }));

    const excludeInstruction = this.excludeWords.length > 0
      ? `\n\nIMPORTANT: Exclude any topics related to these words/subjects: ${this.excludeWords.join(", ")}. Do NOT create topics about these subjects - simply skip those articles.`
      : "";

    const prompt = `You are a senior news editor's assistant at a newsroom covering US and German news. Analyze these ${articles.length} articles and group them into meaningful topics.

Articles:
${JSON.stringify(articleList, null, 0)}

Return a JSON array of topics. Each topic must have:
- "name": A clear, newsroom-quality headline for the topic (3-7 words, e.g. "Ukraine Peace Talks Stall", "Tesla Recalls 500K Vehicles", "Bundestag Debates Immigration Reform")
- "category": One of: world, politics, business, technology, science, health, sports, entertainment, environment, or null
- "urgency": A score from 1 to 5 indicating editorial urgency:
  1 = Low interest, routine coverage
  2 = Normal news story
  3 = Notable story worth tracking
  4 = Major developing story
  5 = Breaking/critical news requiring immediate attention
- "articleIds": Array of article IDs that belong to this topic

Rules:
- Merge articles about the same event or story into one topic, even if from different countries or sources
- If US and German outlets cover the same event, group them together (this increases urgency)
- Give descriptive, specific topic names that a newsroom editor would recognize
- Single articles with no related stories still get their own topic
- Consider recency: very recent articles with multiple sources = higher urgency${excludeInstruction}

Respond ONLY with the JSON array, no other text.`;

    try {
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const aiTopics: AiTopicResult[] = JSON.parse(jsonStr);

      return this.buildTopics(aiTopics, articles);
    } catch (error) {
      console.error("AI clustering failed, falling back to keyword clustering:", error);
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

      // Use AI-assigned urgency, clamped to 1-5
      const urgency = Math.max(1, Math.min(5, aiTopic.urgency || computeUrgency(topicArticles, trendScore, usCount, deCount)));

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
        urgency,
      });
    }

    topics.sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
      return b.totalArticles - a.totalArticles;
    });

    return topics;
  }
}

export function computeUrgency(
  articles: NormalizedArticle[],
  trendScore: number,
  usCount: number,
  deCount: number
): number {
  let score = 1;
  if (articles.length >= 3) score++;
  if (articles.length >= 6) score++;
  if (trendScore >= 0.2) score++;
  if (usCount > 0 && deCount > 0) score++;
  return Math.min(5, score);
}
