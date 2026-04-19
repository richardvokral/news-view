import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteAccessDomain } from "@/lib/access";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const { domain } = await params;
  await deleteAccessDomain(decodeURIComponent(domain));
  return NextResponse.json({ ok: true });
}
