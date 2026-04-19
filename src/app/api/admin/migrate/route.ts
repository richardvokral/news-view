import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runMigrations } from "@/lib/db-migrate";

// Must be Node runtime (db-migrate reads the schema file via fs).
export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const result = await runMigrations();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
