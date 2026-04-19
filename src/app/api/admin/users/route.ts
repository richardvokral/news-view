import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listAccessUsers,
  upsertAccessUser,
  ALL_SECTIONS,
  type Section,
} from "@/lib/access";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const users = await listAccessUsers();
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email : "";
    const validSet = new Set<string>(ALL_SECTIONS);
    const sections: Section[] = Array.isArray(body.sections)
      ? (body.sections as unknown[]).filter(
          (s): s is Section => typeof s === "string" && validSet.has(s)
        )
      : [];
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    await upsertAccessUser(email, sections);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
