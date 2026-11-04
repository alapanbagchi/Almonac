import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthApiError, createAuthApi } from "@/lib/auth/api";
import { loadWebConfig } from "@/lib/auth/config";
import { readCredentials } from "@/lib/auth/credentials";
import { authError, noStore, serviceUnavailable } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";

const bodySchema = z.object({ token: z.string().min(32).max(128) });

/**
 * Confirms an email address after sign-up. The API creates the provider
 * identity only when the token is valid, so no account exists before this call.
 */
export async function POST(request: Request): Promise<Response> {
  let config;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }
  if (!hasTrustedOrigin(request, config.publicOrigin)) {
    return authError(403, "FORBIDDEN", "Cross-origin request refused.");
  }

  const body = await readCredentials(request, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await createAuthApi({ baseUrl: config.apiUrl }).verifyEmail(body.value.token);
    return noStore(NextResponse.json(result));
  } catch (error) {
    if (error instanceof AuthApiError) {
      if (error.code === "EMAIL_VERIFICATION_INVALID") {
        return authError(422, error.code, "This verification link is not valid or has expired.");
      }
      if (error.code === "EMAIL_TAKEN") {
        return authError(409, error.code, "An account with this email already exists.");
      }
      if (error.code === "RATE_LIMITED") {
        return authError(429, error.code, "Too many attempts. Try again shortly.");
      }
    }
    return authError(503, "AUTH_UNAVAILABLE", "Verification is unavailable. Try again shortly.");
  }
}
