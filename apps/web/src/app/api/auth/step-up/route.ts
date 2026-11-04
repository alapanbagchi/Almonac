import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createAuthApi, AuthApiError } from "@/lib/auth/api";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import { LOGIN_COOKIE_NAME, loginCookieOptions } from "@/lib/auth/cookies";
import { InvalidReturnToError, normaliseReturnTo } from "@/lib/auth/return-to";
import { noStore, serviceUnavailable, stepUpFailureResponse } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { getSessionToken } from "@/lib/auth/session";
import { readLoginState } from "@/lib/auth/tokens";
import { BodyTooLargeError, readBoundedBody } from "@/lib/http/bounded-body";

/**
 * Starts a step-up check for the signed-in member. The API rotates the session
 * on the callback, so the browser receives a new opaque token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }
  const origin = config.publicOrigin;

  if (!hasTrustedOrigin(request, origin)) {
    return noStore(
      new NextResponse("Request not allowed.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

  let rawReturnTo: string | null;
  try {
    rawReturnTo = new URLSearchParams(await readBoundedBody(request)).get("returnTo");
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return noStore(
        new NextResponse("Request body is too large.", {
          status: 413,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    }
    return stepUpFailureResponse(origin, "/dashboard", "invalid");
  }

  let returnTo: string;
  try {
    returnTo = normaliseReturnTo(rawReturnTo, "/dashboard");
  } catch (error) {
    if (!(error instanceof InvalidReturnToError)) throw error;
    return stepUpFailureResponse(origin, "/dashboard", "invalid");
  }

  const token = await getSessionToken();
  if (token === null) {
    const url = new URL("/login", origin);
    url.searchParams.set("returnTo", returnTo);
    return noStore(NextResponse.redirect(url, 303));
  }

  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await createAuthApi({ baseUrl: config.apiUrl }).startStepUp(
      token,
      returnTo,
    ));
  } catch (error) {
    const failure =
      error instanceof AuthApiError && (error.status === 0 || error.status === 503)
        ? "unavailable"
        : "failed";
    return stepUpFailureResponse(origin, returnTo, failure);
  }

  const state = readLoginState(authorizationUrl);
  if (state === null) return stepUpFailureResponse(origin, returnTo, "unavailable");

  const response = NextResponse.redirect(authorizationUrl, 303);
  response.cookies.set(LOGIN_COOKIE_NAME, state, loginCookieOptions());
  return noStore(response);
}
