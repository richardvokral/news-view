import { NormalizedArticle, Topic } from "../fetchers/types";
import { ClusteringStrategy } from "./types";
import { jaccardSimilarity } from "./tokenizer";
import { hashId } from "../fetchers/utils";

class UnionFind {
  parent: number[];
  rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
  }
}

const SIMILARITY_THRESHOLD = 0.25;

export class KeywordClustering implements ClusteringStrategy {
  async cluster(articles: NormalizedArticle[]): Promise<Topic[]> {
    if (articles.length === 0) return [];

    const uf = new UnionFind(articles.length);

    // Pairwise comparison
    for (let i = 0; i < articles.length; i++) {
      for (let j = i + 1; j < articles.length; j++) {
        if (articles[i].keywords.length === 0 || articles[j].keywords.length === 0) continue;
        const sim = jaccardSimilarity(articles[i].keywords, articles[j].keywords);
        if (sim >= SIMILARITY_THRESHOLD) {
          uf.union(i, j);
        }
      }
    }

    // Group articles by cluster root
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < articles.length; i++) {
      const root = uf.find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(i);
    }

    // Build topics
    const topics: Topic[] = [];
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const [, indices] of clusters) {
      const clusterArticles = indices.map((i) => articles[i]);

      // Find most common keywords for topic name
      const keywordCounts = new Map<string, number>();
      for (const article of clusterArticles) {
        for (const kw of article.keywords) {
          keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
        }
      }

      const topKeywords = [...keywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([kw]) => kw);

      const name =
        topKeywords.length > 0
          ? topKeywords.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(" ")
          : clusterArticles[0].title.slice(0, 50);

      const usCount = clusterArticles.filter((a) => a.sourceCountry === "us").length;
      const deCount = clusterArticles.filter((a) => a.sourceCountry === "de").length;

      const latestPublishedAt = clusterArticles.reduce(
        (latest, a) => (a.publishedAt > latest ? a.publishedAt : latest),
        clusterArticles[0].publishedAt
      );

      // Trend score: articles in last 2h / articles in last 24h
      const recentCount = clusterArticles.filter(
        (a) => new Date(a.publishedAt).getTime() > twoHoursAgo
      ).length;
      const dayCount = clusterArticles.filter(
        (a) => new Date(a.publishedAt).getTime() > oneDayAgo
      ).length;
      const trendScore = dayCount > 0 ? recentCount / dayCount : 0;

      // Find most common category
      const categoryCounts = new Map<string, number>();
      for (const a of clusterArticles) {
        if (a.category) {
          categoryCounts.set(a.category, (categoryCounts.get(a.category) || 0) + 1);
        }
      }
      const topCategory = categoryCounts.size > 0
        ? [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;

      topics.push({
        id: hashId(topKeywords.join("-")),
        name,
        keywords: topKeywords,
        articles: clusterArticles,
        countByCountry: { us: usCount, de: deCount },
        totalArticles: clusterArticles.length,
        latestPublishedAt,
        trendScore,
        category: topCategory,
      });
    }

    // Sort by trend score, then total articles
    topics.sort((a, b) => {
      if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
      return b.totalArticles - a.totalArticles;
    });

    return topics;
  }
}
