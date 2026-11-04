import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { loadWebConfig } from "@/lib/auth/config";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { readCredentials } from "@/lib/auth/credentials";
import { authError, noStore, serviceUnavailable } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { isSessionToken } from "@/lib/auth/tokens";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63),
});

export async function POST(request: NextRequest): Promise<Response> {
  let config;
  try {
    config = loadWebConfig();
  } catch {
    return serviceUnavailable();
  }
  if (!hasTrustedOrigin(request, config.publicOrigin)) {
    return authError(403, "FORBIDDEN", "Cross-origin request refused.");
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || !isSessionToken(token)) {
    return authError(401, "AUTH_REQUIRED", "Sign in to continue.");
  }

  const body = await readCredentials(request, bodySchema);
  if (!body.ok) return body.response;

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/onboarding/organisation`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body.value),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return authError(503, "ONBOARDING_UNAVAILABLE", "The service did not respond.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = readError(payload);
    return authError(response.status, error?.code ?? "ONBOARDING_FAILED", error?.message ?? "The organisation could not be created.");
  }
  return noStore(NextResponse.json(payload, { status: 201 }));
}

function readError(value: unknown): { code: string; message: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.message !== "string") return null;
  return { code: record.code, message: record.message };
}
