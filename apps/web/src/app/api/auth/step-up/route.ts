import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createAuthApi, AuthApiError } from "@/lib/auth/api";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import { InvalidReturnToError, normaliseReturnTo } from "@/lib/auth/return-to";
import {
  browserCallbackRedirect,
  noStore,
  serviceUnavailable,
  stepUpFailureResponse,
} from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { getSessionToken } from "@/lib/auth/session";
import { BodyTooLargeError, readBoundedBody } from "@/lib/http/bounded-body";

/**
 * Re-authenticates the signed-in member with their password. The API rotates
 * the session on the callback, so the browser receives a new opaque token.
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

  let password: string;
  let rawReturnTo: string | null;
  try {
    const form = new URLSearchParams(await readBoundedBody(request));
    password = form.get("password") ?? "";
    rawReturnTo = form.get("returnTo");
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

  if (password.length === 0) return stepUpFailureResponse(origin, returnTo, "credentials");

  try {
    const { callbackUrl } = await createAuthApi({ baseUrl: config.apiUrl }).stepUp(token, {
      password,
      returnTo,
    });
    return browserCallbackRedirect(callbackUrl, origin);
  } catch (error) {
    return stepUpFailureResponse(origin, returnTo, stepUpFailureOf(error));
  }
}

function stepUpFailureOf(error: unknown): "credentials" | "failed" | "mfa" | "unavailable" {
  if (!(error instanceof AuthApiError)) return "failed";
  if (error.status === 0 || error.status === 503) return "unavailable";
  if (error.code === "MFA_REQUIRED") return "mfa";
  if (error.status === 401) return "credentials";
  return "failed";
}
