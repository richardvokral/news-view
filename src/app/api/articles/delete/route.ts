import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteAllArticles } from "@/lib/storage/articles";

export async function POST() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  try {
    const { redis, db } = await deleteAllArticles();
    return NextResponse.json({ success: true, deleted: { redis, db } });
  } catch (error) {
    return NextResponse.json(
      { error: "Delete failed", details: String(error) },
      { status: 500 }
    );
  }
}
