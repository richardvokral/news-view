import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  aggregateByModel,
  aggregateByUser,
  listUsage,
} from "@/lib/proofread/usage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const groupBy = request.nextUrl.searchParams.get("groupBy");
  if (groupBy === "model") {
    return NextResponse.json({ rows: await aggregateByModel() });
  }
  if (groupBy === "request") {
    return NextResponse.json({ rows: await listUsage(200) });
  }
  return NextResponse.json({ rows: await aggregateByUser() });
}
