import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listTitleHistoryForArticle } from "@/lib/monitor/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("monitor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const path = request.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return NextResponse.json(
      { error: "Missing or invalid path" },
      { status: 400 }
    );
  }

  const history = await listTitleHistoryForArticle(path);
  return NextResponse.json({ pagePath: path, history });
}
