import { NextRequest, NextResponse } from "next/server";
import { getApiConfig } from "@/lib/storage/settings";

export const dynamic = "force-dynamic";

function isAuthenticated(request: NextRequest): boolean {
  return request.cookies.get("settings_auth")?.value === "true";
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { service } = await request.json();
    const config = await getApiConfig();

    switch (service) {
      case "worldNewsApi":
        return await testWorldNewsApi(config.worldNewsApi.apiKey);
      case "newsDataHub":
        return await testNewsDataHub(config.newsDataHub.apiKey);
      case "gnews":
        return await testGNews(config.gnews.apiKey);
      case "twitter":
        return await testTwitter(config.twitter.bearerToken);
      case "anthropic":
        return await testAnthropic(config.clustering.anthropicApiKey);
      default:
        return NextResponse.json({ success: false, error: "Unknown service" });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: `Test failed: ${error}`,
    });
  }
}

async function testWorldNewsApi(apiKey: string) {
  if (!apiKey) return NextResponse.json({ success: false, error: "No API key" });

  const res = await fetch(
    `https://api.worldnewsapi.com/top-news?source-country=us&language=en&api-key=${apiKey}`
  );
  if (res.ok) {
    return NextResponse.json({ success: true, message: "WorldNewsAPI OK" });
  }
  const text = await res.text();
  return NextResponse.json({ success: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` });
}

async function testNewsDataHub(apiKey: string) {
  if (!apiKey) return NextResponse.json({ success: false, error: "No API key" });

  const res = await fetch(
    "https://api.newsdatahub.com/v1/news?country=US&language=en",
    { headers: { "X-API-Key": apiKey } }
  );
  if (res.ok) {
    return NextResponse.json({ success: true, message: "NewsDataHub OK" });
  }
  const text = await res.text();
  return NextResponse.json({ success: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` });
}

async function testGNews(apiKey: string) {
  if (!apiKey) return NextResponse.json({ success: false, error: "No API key" });

  const res = await fetch(
    `https://gnews.io/api/v4/top-headlines?category=general&country=us&lang=en&max=1&apikey=${apiKey}`
  );
  if (res.ok) {
    return NextResponse.json({ success: true, message: "GNews OK" });
  }
  const text = await res.text();
  return NextResponse.json({ success: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` });
}

async function testTwitter(bearerToken: string) {
  if (!bearerToken) return NextResponse.json({ success: false, error: "No bearer token" });

  const res = await fetch(
    "https://api.x.com/2/tweets/search/recent?query=test&max_results=10",
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );
  if (res.ok) {
    return NextResponse.json({ success: true, message: "Twitter/X API v2 OK" });
  }
  const text = await res.text();
  return NextResponse.json({ success: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` });
}

async function testAnthropic(apiKey: string) {
  if (!apiKey) return NextResponse.json({ success: false, error: "No API key" });

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: "Say OK" }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return NextResponse.json({ success: true, message: `Anthropic OK: ${text}` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error).slice(0, 150) });
  }
}
