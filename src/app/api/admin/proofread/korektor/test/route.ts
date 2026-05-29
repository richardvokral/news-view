import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getKorektorConfig } from "@/lib/proofread/store";
import { runKorektor } from "@/lib/proofread/korektor";

export const runtime = "nodejs";
export const maxDuration = 60;

// A sentence with deliberate spelling / diacritic errors so the admin can see
// Korektor produce concrete suggestions.
const SAMPLE = "Přílyš žluťoučky kůň ůpěl ďábelské ódi.";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  let endpoint = "";
  let model = "";
  try {
    const body = (await request.json().catch(() => ({}))) as {
      endpoint?: unknown;
      model?: unknown;
    };
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    model = typeof body.model === "string" ? body.model : "";
  } catch {
    // empty body is fine — fall back to saved config below
  }
  if (!endpoint || !model) {
    const saved = await getKorektorConfig();
    endpoint = endpoint || saved.endpoint;
    model = model || saved.model;
  }

  try {
    const result = await runKorektor({
      endpoint,
      model,
      title: null,
      bodyHtml: SAMPLE,
    });
    return NextResponse.json({
      ok: true,
      sample: SAMPLE,
      suggestions: result.suggestions,
      acknowledgements: result.acknowledgements,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Test failed",
    });
  }
}
