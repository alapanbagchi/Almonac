import { NextResponse } from "next/server";

import { readCallback } from "./callback-url";
import { clearedCookieOptions, LOGIN_COOKIE_NAME, loginCookieOptions } from "./cookies";
import {
  loginFailureUrl,
  stepUpFailureUrl,
  type LoginFailure,
  type StepUpFailure,
} from "./redirects";

export function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export function authError(status: number, code: string, message: string): NextResponse {
  return noStore(
    NextResponse.json({ error: { code, message } }, { status }),
  );
}

/**
 * Return the provider callback to the browser and bind its state to this
 * browser with the login cookie. The cookie is the anti-forgery measure: the
 * callback handler refuses a state that the browser did not start.
 */
export function browserLoginResponse(
  callbackUrl: string,
  publicOrigin: string,
): NextResponse {
  const callback = readCallback(callbackUrl, publicOrigin);
  if (callback === null) {
    return authError(502, "AUTH_INVALID_RESPONSE", "The sign-in response was not valid.");
  }

  const response = NextResponse.json({ redirectUrl: callback.url });
  response.cookies.set(LOGIN_COOKIE_NAME, callback.state, loginCookieOptions());
  return noStore(response);
}

export function loginFailureResponse(
  origin: string,
  failure: LoginFailure,
  clearLogin = false,
): NextResponse {
  const response = NextResponse.redirect(loginFailureUrl(origin, failure), 303);
  if (clearLogin) response.cookies.set(LOGIN_COOKIE_NAME, "", clearedCookieOptions());
  return noStore(response);
}

export function stepUpFailureResponse(
  origin: string,
  returnTo: string,
  failure: StepUpFailure,
): NextResponse {
  return noStore(NextResponse.redirect(stepUpFailureUrl(origin, returnTo, failure), 303));
}

export function serviceUnavailable(): NextResponse {
  return noStore(
    new NextResponse("Authentication is unavailable.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}
