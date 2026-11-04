import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createAuthApi, AuthApiError } from "@/lib/auth/api";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import {
  clearedCookieOptions,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { loginFailureResponse, noStore, serviceUnavailable } from "@/lib/auth/responses";
import { isSessionToken } from "@/lib/auth/tokens";

export async function GET(request: NextRequest): Promise<NextResponse> {
  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }
  const origin = config.publicOrigin;
  const failure = (reason: "denied" | "expired" | "failed" | "unavailable") =>
    loginFailureResponse(origin, reason, true);

  const params = new URL(request.url).searchParams;
  if (params.has("error")) return failure("denied");

  const code = params.get("code");
  const state = params.get("state");
  if (
    code === null ||
    code.length === 0 ||
    code.length > 4_096 ||
    state === null ||
    !isSessionToken(state)
  ) {
    return failure("expired");
  }

  const binding = request.cookies.get(LOGIN_COOKIE_NAME)?.value;
  if (binding === undefined || binding !== state) return failure("expired");

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  let result;
  try {
    result = await createAuthApi({ baseUrl: config.apiUrl }).completeLogin(
      code,
      state,
      sessionToken !== null && isSessionToken(sessionToken) ? sessionToken : null,
    );
  } catch (error) {
    return failure(
      error instanceof AuthApiError && (error.status === 0 || error.status === 503)
        ? "unavailable"
        : "failed",
    );
  }

  if (result.expiresAt.getTime() <= Date.now()) return failure("expired");

  const response = NextResponse.redirect(new URL(result.returnTo, origin), 303);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    result.token,
    sessionCookieOptions(result.expiresAt),
  );
  response.cookies.set(LOGIN_COOKIE_NAME, "", clearedCookieOptions());
  return noStore(response);
}
