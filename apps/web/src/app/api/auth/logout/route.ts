import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createAuthApi } from "@/lib/auth/api";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import {
  clearedCookieOptions,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/cookies";
import { safeEndSessionUrl } from "@/lib/auth/redirects";
import { noStore, serviceUnavailable } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { isSessionToken } from "@/lib/auth/tokens";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }

  if (!hasTrustedOrigin(request, config.publicOrigin)) {
    return noStore(new NextResponse(null, { status: 403 }));
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let endSessionUrl: string | null = null;
  if (isSessionToken(token)) {
    try {
      endSessionUrl = await createAuthApi({ baseUrl: config.apiUrl }).logout(token);
    } catch {
      // The local session still ends, so a failing provider cannot trap the user.
    }
  }

  const target =
    safeEndSessionUrl(endSessionUrl, config.publicOrigin) ??
    new URL("/login", config.publicOrigin);

  const response = NextResponse.redirect(target, 303);
  response.cookies.set(SESSION_COOKIE_NAME, "", clearedCookieOptions());
  response.cookies.set(LOGIN_COOKIE_NAME, "", clearedCookieOptions());
  return noStore(response);
}
