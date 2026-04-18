import { Fetcher, NormalizedArticle } from "./types";
import { hashId } from "./utils";

interface TweetV2 {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  author_id?: string;
}

interface TwitterV2Response {
  data?: TweetV2[];
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count?: number;
  };
  errors?: Array<{ message: string; type: string }>;
}

const SEARCH_QUERIES: Record<string, string> = {
  us: 'lang:en -is:retweet -is:reply has:links (breaking OR "breaking news" OR developing)',
  de: "lang:de -is:retweet -is:reply has:links (Nachrichten OR Meldung OR Bericht)",
};

const FALLBACK_QUERIES: Record<string, string> = {
  us: "lang:en -is:retweet -is:reply has:links",
  de: "lang:de -is:retweet -is:reply has:links",
};

export function createTwitterFetcher(bearerToken: string): Fetcher {
  return {
    name: "twitter",
    async fetch(country, since) {
      let articles = await searchTweets(bearerToken, country, SEARCH_QUERIES[country], since);
      if (articles.length === 0) {
        articles = await searchTweets(bearerToken, country, FALLBACK_QUERIES[country], since);
      }
      return articles;
    },
  };
}

async function searchTweets(
  bearerToken: string,
  country: "us" | "de",
  query: string,
  since?: string | null
): Promise<NormalizedArticle[]> {
  const params = new URLSearchParams({
    query,
    max_results: "25",
    sort_order: "relevancy",
    "tweet.fields": "created_at,public_metrics,author_id",
  });

  if (since) {
    params.set("start_time", since);
  }

  const url = `https://api.x.com/2/tweets/search/recent?${params}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 429) {
      console.warn("Twitter API rate limit reached, skipping");
      return [];
    }
    console.error(`Twitter API v2 error: ${res.status} ${errorText}`);
    return [];
  }

  const data: TwitterV2Response = await res.json();

  if (data.errors?.length) {
    console.error("Twitter API v2 errors:", data.errors);
  }

  const tweets = data.data ?? [];
  const articles: NormalizedArticle[] = [];

  for (const tweet of tweets) {
    const cleanText = tweet.text
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText || cleanText.length < 10) continue;

    const metrics = tweet.public_metrics;
    const engagement = metrics
      ? metrics.retweet_count + metrics.like_count + metrics.quote_count
      : 0;

    articles.push({
      id: hashId(`twitter-${tweet.id}`),
      title: cleanText.length > 200 ? cleanText.slice(0, 200) + "..." : cleanText,
      summary: metrics
        ? `${engagement.toLocaleString()} engagements on X`
        : "From X",
      url: `https://x.com/i/status/${tweet.id}`,
      imageUrl: null,
      publishedAt: tweet.created_at ?? new Date().toISOString(),
      source: "twitter",
      sourceCountry: country,
      category: null,
      keywords: [],
    });
  }

  return articles;
}
