import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { defaultDashboardConfig } from "@/lib/dashboard/default-config";
import {
  getUserLayout,
  getAdminDefault,
  saveUserLayout,
  saveAdminDefault,
  deleteUserLayout,
} from "@/lib/dashboard/queries";

export async function GET() {
  const session = await getSession();
  if (!session.email || !session.sections.includes("reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (hasDb()) {
    const userLayout = await getUserLayout(session.email);
    if (userLayout) {
      return NextResponse.json({
        widgets: userLayout,
        source: "user",
        isAdmin: session.isAdmin,
      });
    }
    const adminDefault = await getAdminDefault();
    if (adminDefault) {
      return NextResponse.json({
        widgets: adminDefault,
        source: "admin_default",
        isAdmin: session.isAdmin,
      });
    }
  }

  return NextResponse.json({
    widgets: defaultDashboardConfig,
    source: "static",
    isAdmin: session.isAdmin,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session.email || !session.sections.includes("reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasDb()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { widgets, saveMode } = body as {
    widgets?: unknown;
    saveMode?: string;
  };

  if (saveMode === "restore_default") {
    await deleteUserLayout(session.email);
    return NextResponse.json({ ok: true });
  }

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

  switch (saveMode) {
    case "save_for_me":
      await saveUserLayout(
        session.email,
        widgets as import("@/types/dashboard").WidgetConfig[]
      );
      return NextResponse.json({ ok: true });
    case "save_as_default":
      if (!session.isAdmin) {
        return NextResponse.json(
          { error: "Admin required" },
          { status: 403 }
        );
      }
      await saveAdminDefault(
        session.email,
        widgets as import("@/types/dashboard").WidgetConfig[]
      );
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Invalid saveMode" }, { status: 400 });
  }
}
