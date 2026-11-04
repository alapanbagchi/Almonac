import { NextResponse } from "next/server";

import { clearedCookieOptions, LOGIN_COOKIE_NAME } from "./cookies";
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
