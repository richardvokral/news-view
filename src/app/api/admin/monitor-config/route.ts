import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMonitorConfig, saveMonitorConfig } from "@/lib/monitor/config";
import type { MonitorConfig } from "@/types/dashboard";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return { denied: NextResponse.json({ error: "Admin required" }, { status: 403 }) };
  }
  return { email: session.email };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const config = await getMonitorConfig();
  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    const body = (await request.json()) as Partial<MonitorConfig>;
    const clean: Partial<MonitorConfig> = {};
    if (typeof body.enabled === "boolean") clean.enabled = body.enabled;
    if (typeof body.intervalSeconds === "number") clean.intervalSeconds = body.intervalSeconds;
    if (typeof body.windowHours === "number") clean.windowHours = body.windowHours;
    if (typeof body.retentionDays === "number") clean.retentionDays = body.retentionDays;
    if (typeof body.maxRequestsPerHour === "number")
      clean.maxRequestsPerHour = body.maxRequestsPerHour;
    if (typeof body.sourceSamplingEnabled === "boolean")
      clean.sourceSamplingEnabled = body.sourceSamplingEnabled;
    if (typeof body.sourceSamplingTopN === "number")
      clean.sourceSamplingTopN = body.sourceSamplingTopN;
    if (typeof body.trendWindowMinutes === "number")
      clean.trendWindowMinutes = body.trendWindowMinutes;
    if (typeof body.sourceTimeseriesEnabled === "boolean")
      clean.sourceTimeseriesEnabled = body.sourceTimeseriesEnabled;
    if (Array.isArray(body.excludedSources)) {
      clean.excludedSources = body.excludedSources
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
    if (body.sitePatterns && typeof body.sitePatterns === "object") {
      const sp: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.sitePatterns)) {
        if (typeof k === "string" && typeof v === "string") sp[k] = v;
      }
      clean.sitePatterns = sp;
    }
    if (typeof body.rssEnabled === "boolean") clean.rssEnabled = body.rssEnabled;
    if (body.siteRssUrls && typeof body.siteRssUrls === "object") {
      const sr: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.siteRssUrls)) {
        if (typeof k === "string" && typeof v === "string") sr[k] = v;
      }
      clean.siteRssUrls = sr;
    }
    if (typeof body.showArticleImages === "boolean")
      clean.showArticleImages = body.showArticleImages;
    if (body.authorShortNames && typeof body.authorShortNames === "object") {
      const an: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.authorShortNames)) {
        if (typeof k === "string" && typeof v === "string") an[k] = v;
      }
      clean.authorShortNames = an;
    }
    if (typeof body.authorSamplingEnabled === "boolean")
      clean.authorSamplingEnabled = body.authorSamplingEnabled;
    if (typeof body.topSourcesLimit === "number")
      clean.topSourcesLimit = body.topSourcesLimit;
    await saveMonitorConfig(gate.email, clean);
    const updated = await getMonitorConfig();
    return NextResponse.json({ config: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
