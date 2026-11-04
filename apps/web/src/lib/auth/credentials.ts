import { z } from "zod";

import { AuthApiError } from "@/lib/auth/api";
import { authError } from "@/lib/auth/responses";
import { BodyTooLargeError, readBoundedBody } from "@/lib/http/bounded-body";

export const MAX_AUTH_BODY_BYTES = 8 * 1024;

/** Bounded JSON body for a credential form. */
export async function readCredentials<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; value: z.infer<T> } | { ok: false; response: Response }> {
  let raw: string;
  try {
    raw = await readBoundedBody(request, MAX_AUTH_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return { ok: false, response: authError(413, "PAYLOAD_TOO_LARGE", "The request is too large.") };
    }
    return { ok: false, response: authError(400, "INVALID_REQUEST", "The request could not be read.") };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: authError(400, "INVALID_REQUEST", "The request is not valid JSON.") };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: authError(400, "INVALID_REQUEST", "Check the form and try again.") };
  }
  return { ok: true, value: parsed.data };
}

export function credentialFailure(error: unknown): Response {
  if (error instanceof AuthApiError) {
    if (error.code === "EMAIL_TAKEN") {
      return authError(409, error.code, "An account with this email already exists.");
    }
    if (error.code === "MFA_REQUIRED") {
      return authError(403, error.code, "This account needs multi-factor authentication. Use single sign-on.");
    }
    if (error.code === "RATE_LIMITED") {
      return authError(429, error.code, "Too many attempts. Try again shortly.");
    }
    if (
      error.code === "VALIDATION_FAILED" ||
      error.code === "INVALID_EMAIL" ||
      error.code === "INVALID_NAME" ||
      error.code === "INVALID_PASSWORD"
    ) {
      return authError(400, error.code, "Check the form and try again.");
    }
    if (error.status === 401) {
      return authError(401, "AUTH_FAILED", "The email or password is not correct.");
    }
    if (error.code === "REGISTRATION_REJECTED") {
      return authError(422, error.code, "The account could not be created.");
    }
    if (error.code === "MAIL_UNAVAILABLE") {
      return authError(503, error.code, "The verification email could not be sent. Try again shortly.");
    }
  }
  return authError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable. Try again shortly.");
}
