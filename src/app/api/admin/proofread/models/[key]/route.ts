import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteModel } from "@/lib/proofread/store";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const { key } = await params;
  await deleteModel(decodeURIComponent(key));
  return NextResponse.json({ ok: true });
}
