import { NextResponse } from "next/server";
import { z } from "zod";

import { createAuthApi } from "@/lib/auth/api";
import { loadWebConfig } from "@/lib/auth/config";
import { credentialFailure, readCredentials } from "@/lib/auth/credentials";
import { authError, noStore, serviceUnavailable } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";

const bodySchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().min(3).max(320),
  password: z.string().min(8).max(72),
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

  try {
    await createAuthApi({ baseUrl: config.apiUrl }).register(body.value);
    return noStore(NextResponse.json({ status: "verification_sent" }, { status: 202 }));
  } catch (error) {
    return credentialFailure(error);
  }
}
