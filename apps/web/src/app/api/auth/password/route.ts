import { z } from "zod";

import { createAuthApi } from "@/lib/auth/api";
import { loadWebConfig } from "@/lib/auth/config";
import { credentialFailure, readCredentials } from "@/lib/auth/credentials";
import { authError, browserLoginResponse, serviceUnavailable } from "@/lib/auth/responses";
import { InvalidReturnToError, normaliseReturnTo } from "@/lib/auth/return-to";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";

const bodySchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1024),
  returnTo: z.string().max(2048).optional(),
});

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

  let returnTo: string;
  try {
    returnTo = normaliseReturnTo(body.value.returnTo, "/dashboard");
  } catch (error) {
    if (error instanceof InvalidReturnToError) {
      return authError(400, "INVALID_RETURN_TO", "The return path is not valid.");
    }
    throw error;
  }

  try {
    const { callbackUrl } = await createAuthApi({ baseUrl: config.apiUrl }).passwordLogin({
      email: body.value.email,
      password: body.value.password,
      returnTo,
    });
    return browserLoginResponse(callbackUrl, config.publicOrigin);
  } catch (error) {
    return credentialFailure(error);
  }
}
