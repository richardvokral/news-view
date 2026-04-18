import { NextRequest } from "next/server";

// TODO: Replace with Logto session check when implementing Logto auth
// import { getLogtoContext } from '@logto/next/server-actions';
// import { logtoConfig } from './logto-config';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
}

export function isAuthenticated(request: NextRequest): boolean {
  // Current: simple cookie-based auth
  // TODO: Replace with Logto session validation
  return request.cookies.get("settings_auth")?.value === "true";
}

// TODO: Implement when Logto is configured
// export async function getUser(request: NextRequest): Promise<AuthUser | null> {
//   const context = await getLogtoContext(logtoConfig);
//   if (!context.isAuthenticated) return null;
//   return {
//     id: context.claims?.sub ?? '',
//     email: context.claims?.email,
//     name: context.claims?.name,
//   };
// }
