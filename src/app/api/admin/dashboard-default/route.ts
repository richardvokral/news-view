import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveAdminDefault } from "@/lib/dashboard/queries";
import type { WidgetConfig } from "@/types/dashboard";

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const widgets = body.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return NextResponse.json(
      { error: "widgets must be a non-empty array" },
      { status: 400 }
    );
  }
  for (const w of widgets as Array<Record<string, unknown>>) {
    if (!w || !w.id || !w.type || !w.title) {
      return NextResponse.json(
        { error: "Each widget must have id, type, and title" },
        { status: 400 }
      );
    }
  }
  await saveAdminDefault(session.email, widgets as WidgetConfig[]);
  return NextResponse.json({ ok: true });
}
