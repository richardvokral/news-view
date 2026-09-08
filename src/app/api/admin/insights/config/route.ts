import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInsightsConfig, saveInsightsConfig } from "@/lib/insights/store";
import type { InsightsConfig } from "@/lib/insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return NextResponse.json({ config: await getInsightsConfig() });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Partial<InsightsConfig> = {};

    const numFields: (keyof InsightsConfig)[] = [
      "backfillWeeks",
      "weeksPerRequest",
      "pageLimit",
      "maxPagesPerWeek",
      "maxRequestsPerRun",
      "refetchGraceHours",
      "aiTopArticles",
    ];
    for (const f of numFields) {
      const v = body[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        (patch as Record<string, unknown>)[f] = v;
      }
    }
    if (typeof body.articlePathFilter === "string") {
      patch.articlePathFilter = body.articlePathFilter;
    }
    if (typeof body.articlePathRegex === "string") {
      patch.articlePathRegex = body.articlePathRegex;
    }
    if (typeof body.aiModelKey === "string" || body.aiModelKey === null) {
      patch.aiModelKey = (body.aiModelKey as string) || null;
    }
    if (Array.isArray(body.sectionVocabulary)) {
      patch.sectionVocabulary = body.sectionVocabulary.filter(
        (v): v is string => typeof v === "string"
      );
    }

    // A bad regex here would silently degrade every future parse, so reject it.
    if (patch.articlePathRegex) {
      try {
        new RegExp(patch.articlePathRegex);
      } catch {
        return NextResponse.json(
          { error: "Neplatný regulární výraz pro cestu článku." },
          { status: 400 }
        );
      }
    }

    const config = await saveInsightsConfig(gate.email, patch);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
