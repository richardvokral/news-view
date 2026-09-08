import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isKnownSite } from "@/lib/plausible";
import { getAnalysisRun, listAnalysisRuns } from "@/lib/insights/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("insights")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;

  // ?id= returns one run with its full result; the list omits results so the
  // history stays cheap to load.
  const idRaw = sp.get("id");
  if (idRaw) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const run = await getAnalysisRun(id);
    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isKnownSite(run.siteId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ run });
  }

  const site = sp.get("site") ?? "";
  if (!site || !isKnownSite(site)) {
    return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  const runs = await listAnalysisRuns(site, 25);
  return NextResponse.json({ runs });
}
