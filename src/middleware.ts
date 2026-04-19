import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/reports",
  "/monitor",
  "/admin",
  "/api/admin",
  "/api/plausible",
  "/api/dashboard-layout",
  "/api/monitor",
  "/no-access",
];

const PUBLIC_EXCEPTIONS = ["/api/logto", "/api/cron"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXCEPTIONS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!needsAuth) return NextResponse.next();

  const appId = process.env.LOGTO_APP_ID || "";
  const sessionCookie = request.cookies.get(`logto_${appId}`);
  if (!sessionCookie?.value) {
    return NextResponse.redirect(new URL("/api/logto/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/reports/:path*",
    "/monitor/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/plausible",
    "/api/plausible/:path*",
    "/api/dashboard-layout",
    "/api/dashboard-layout/:path*",
    "/api/monitor/:path*",
    "/no-access",
  ],
};
