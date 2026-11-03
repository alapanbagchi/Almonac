import { NextResponse } from "next/server";

import { createAuthApi, AuthApiError } from "@/lib/auth/api";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import { LOGIN_COOKIE_NAME, loginCookieOptions } from "@/lib/auth/cookies";
import { loginFailureResponse, noStore, serviceUnavailable } from "@/lib/auth/responses";
import { isCrossSiteNavigation } from "@/lib/auth/same-origin";
import { InvalidReturnToError, normaliseReturnTo } from "@/lib/auth/return-to";
import { readLoginState } from "@/lib/auth/tokens";

export async function GET(request: Request): Promise<NextResponse> {
  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }
  const origin = config.publicOrigin;

  if (isCrossSiteNavigation(request)) return loginFailureResponse(origin, "denied");

  let returnTo: string;
  try {
    returnTo = normaliseReturnTo(new URL(request.url).searchParams.get("returnTo"), "/dashboard");
  } catch (error) {
    if (error instanceof InvalidReturnToError) return loginFailureResponse(origin, "invalid");
    throw error;
  }

  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await createAuthApi({ baseUrl: config.apiUrl }).startLogin(returnTo));
  } catch (error) {
    const failure = error instanceof AuthApiError && error.status === 503 ? "unavailable" : "failed";
    return loginFailureResponse(origin, failure);
  }

  const state = readLoginState(authorizationUrl);
  if (state === null) return loginFailureResponse(origin, "unavailable");

  const response = NextResponse.redirect(authorizationUrl, 302);
  response.cookies.set(LOGIN_COOKIE_NAME, state, loginCookieOptions());
  return noStore(response);
}
