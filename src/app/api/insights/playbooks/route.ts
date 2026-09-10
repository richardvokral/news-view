import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import {
  listPlaybooksForSite,
  playbookKey,
  upsertInsightPrompt,
} from "@/lib/insights/promptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const site = request.nextUrl.searchParams.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  return NextResponse.json({ playbooks: await listPlaybooksForSite(site) });
}

/** Saves the playbook draft an analysis produced, or a hand-edited version. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const site = typeof body.site === "string" ? body.site : "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const text = typeof body.body === "string" ? body.body : "";
  if (!label) return NextResponse.json({ error: "Zadejte název." }, { status: 400 });
  if (!text.trim()) {
    return NextResponse.json({ error: "Playbook je prázdný." }, { status: 400 });
  }

  // A playbook is model-generated prose a human lightly edited, so a
  // hallucinated statistic can ride along unnoticed. Digits and % catch the
  // copied-statistic case; a Czech number-word regex would mangle legitimate
  // rules like "nepoužívej víc než dvě jména", so the output contract handles
  // the prose case instead.
  const offending = text
    .split(/\r?\n/)
    .filter((line) => /\d|%/.test(line))
    .slice(0, 3);
  if (offending.length > 0) {
    return NextResponse.json(
      {
        error:
          "Pravidlo obsahuje číslo nebo procento. Playbook nesmí tvrdit nic o výkonu — čísla odstraňte.",
        lines: offending,
      },
      { status: 400 }
    );
  }

  const shared = body.shared === true;
  const siteId = shared ? null : site;
  const key =
    typeof body.key === "string" && body.key.trim()
      ? body.key.trim()
      : playbookKey(siteId, label);

  try {
    await upsertInsightPrompt({
      key,
      label,
      body: text,
      kind: "title_rewrite",
      siteId,
      derivedFromRunId:
        typeof body.runId === "number" && Number.isFinite(body.runId)
          ? body.runId
          : null,
      isDefault: body.isDefault === true,
      updatedBy: session.email,
    });
    return NextResponse.json({
      ok: true,
      key,
      playbooks: await listPlaybooksForSite(site),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Uložení selhalo" },
      { status: 400 }
    );
  }
}
