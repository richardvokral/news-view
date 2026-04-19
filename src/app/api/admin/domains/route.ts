import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listAccessDomains,
  upsertAccessDomain,
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
  const domains = await listAccessDomains();
  return NextResponse.json({ domains });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json();
    const domain = typeof body.domain === "string" ? body.domain : "";
    const validSet = new Set<string>(ALL_SECTIONS);
    const sections: Section[] = Array.isArray(body.sections)
      ? (body.sections as unknown[]).filter(
          (s): s is Section => typeof s === "string" && validSet.has(s)
        )
      : [];
    if (!domain) {
      return NextResponse.json({ error: "domain required" }, { status: 400 });
    }
    await upsertAccessDomain(domain, sections);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}
