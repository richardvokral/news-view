export interface NormalizedArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
  source: "worldnewsapi" | "newsdatahub" | "gnews" | "twitter" | "rss";
  sourceCountry: "us" | "de";
  category: string | null;
  keywords: string[];
}

export interface Fetcher {
  name: string;
  fetch(country: "us" | "de", since?: string | null): Promise<NormalizedArticle[]>;
}

export interface ApiSourceConfig {
  enabled: boolean;
  apiKey: string;
}

export interface RssFeedConfig {
  guardian: boolean;
  spiegel: boolean;
  dw: boolean;
  foxNews: boolean;
  reuters: boolean;
}

export interface ApiConfig {
  worldNewsApi: ApiSourceConfig;
  newsDataHub: ApiSourceConfig;
  gnews: ApiSourceConfig;
  twitter: { enabled: boolean; bearerToken: string };
  rssFeeds: RssFeedConfig;
  clustering: {
    mode: "keywords" | "ai" | "ai-openai" | "hybrid" | "hybrid-openai";
    anthropicApiKey: string;
    openaiApiKey: string;
  };
  excludeWords: string[];
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  worldNewsApi: { enabled: true, apiKey: "" },
  newsDataHub: { enabled: true, apiKey: "" },
  gnews: { enabled: true, apiKey: "" },
  twitter: { enabled: false, bearerToken: "" },
  rssFeeds: { guardian: true, spiegel: true, dw: true, foxNews: false, reuters: false },
  clustering: { mode: "keywords", anthropicApiKey: "", openaiApiKey: "" },
  excludeWords: [],
};

export interface Topic {
  id: string;
  name: string;
  keywords: string[];
  articles: NormalizedArticle[];
  countByCountry: { us: number; de: number };
  totalArticles: number;
  latestPublishedAt: string;
  trendScore: number;
  category: string | null;
  urgency: number;
}
