import { NextResponse } from "next/server";
import { getHourlyStats } from "@/lib/storage/articles";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.email || !session.sections.includes("news")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const hourly = await getHourlyStats(48);
    const total48h = hourly.reduce((sum, h) => sum + h.count, 0);

    return NextResponse.json({ total48h, hourly });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to load stats", details: String(error) },
      { status: 500 }
    );
  }
}
