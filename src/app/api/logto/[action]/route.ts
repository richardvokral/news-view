import { type NextRequest, NextResponse } from "next/server";
import LogtoClient from "@logto/next/edge";
import { logtoConfig } from "@/lib/logto";

let _client: LogtoClient | null = null;

function getClient(): LogtoClient {
  if (!_client) _client = new LogtoClient(logtoConfig);
  return _client;
}

function buildSignOutResponse(): NextResponse {
  const cookieName = `logto_${logtoConfig.appId}`;
  const endSessionUrl = new URL("/oidc/session/end", logtoConfig.endpoint);
  endSessionUrl.searchParams.set("client_id", logtoConfig.appId);
  endSessionUrl.searchParams.set(
    "post_logout_redirect_uri",
    logtoConfig.baseUrl
  );
  const response = NextResponse.redirect(endSessionUrl);
  response.cookies.set(cookieName, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  const client = getClient();
  try {
    switch (action) {
      case "sign-in":
        return await client.handleSignIn()(request);
      case "sign-in-callback":
        return await client.handleSignInCallback()(request);
      case "sign-out":
        return buildSignOutResponse();
      case "user":
        return await client.handleUser({ fetchUserInfo: true })(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  } catch (error) {
    console.error(
      `Logto ${action} error:`,
      error instanceof Error ? error.message : error
    );
    return new Response(
      `Authentication error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { status: 500 }
    );
  }
}
