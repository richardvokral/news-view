import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteUserConfig } from "@/lib/proofread/store";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const { email } = await params;
  await deleteUserConfig(decodeURIComponent(email));
  return NextResponse.json({ ok: true });
}
