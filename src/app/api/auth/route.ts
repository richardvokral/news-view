import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const settingsPassword = process.env.SETTINGS_PASSWORD;

    if (!settingsPassword) {
      return NextResponse.json({ error: "Settings password not configured" }, { status: 500 });
    }

    if (password === settingsPassword) {
      const response = NextResponse.json({ success: true });
      response.cookies.set("settings_auth", "true", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 24, // 24 hours
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
