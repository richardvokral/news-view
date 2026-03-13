import { Fetcher, NormalizedArticle } from "./types";
import { hashId } from "./utils";

interface TwitterTrend {
  name?: string;
  url?: string;
  query?: string;
  tweet_volume?: number | null;
}

interface TwitterTrendsResponse {
  trends?: TwitterTrend[];
  as_of?: string;
}

const WOEID: Record<string, number> = {
  us: 23424977,
  de: 23424829,
};

export function createTwitterFetcher(bearerToken: string): Fetcher {
  return {
    name: "twitter",
    async fetch(country) {
      const woeid = WOEID[country];
      const url = `https://api.twitter.com/1.1/trends/place.json?id=${woeid}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      if (!res.ok) {
        console.error(
          `Twitter API error: ${res.status} ${await res.text()}`
        );
        return [];
      }

      const data: TwitterTrendsResponse[] = await res.json();
      const trends = data[0]?.trends ?? [];
      const articles: NormalizedArticle[] = [];

      for (const trend of trends) {
        if (!trend.name) continue;
        // Skip promoted trends and hashtag-only trends with no volume
        if (trend.name.startsWith("#") && !trend.tweet_volume) continue;

        articles.push({
          id: hashId(`twitter-${country}-${trend.name}`),
          title: trend.name,
          summary: trend.tweet_volume
            ? `${trend.tweet_volume.toLocaleString()} tweets`
            : "Trending on X",
          url: trend.url ?? `https://x.com/search?q=${encodeURIComponent(trend.query ?? trend.name)}`,
          imageUrl: null,
          publishedAt: data[0]?.as_of ?? new Date().toISOString(),
          source: "twitter",
          sourceCountry: country,
          category: null,
          keywords: [],
        });
      }

      return articles;
    },
  };
}
