import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TODO: Replace with Logto authentication middleware
// When Logto is configured, this middleware will:
// 1. Check session token on protected routes (/settings, /api/settings)
// 2. Redirect unauthenticated users to Logto login
// 3. Handle callback from Logto after login
//
// Example:
// import { handleAuth } from '@logto/next';
// export default handleAuth({ config: { ... } });

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  // No routes are protected yet. Update matcher when Logto is ready:
  // matcher: ['/settings/:path*', '/api/settings/:path*'],
  matcher: [],
};
