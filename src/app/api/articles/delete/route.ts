import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { deleteAllArticles } from "@/lib/storage/articles";

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { redis, db } = await deleteAllArticles();
    return NextResponse.json({
      success: true,
      deleted: { redis, db },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Delete failed", details: String(error) },
      { status: 500 }
    );
  }
}
