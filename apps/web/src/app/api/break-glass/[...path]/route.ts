import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isAllowedBreakGlassRequest } from "@/lib/break-glass/allowlist";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import { noStore } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { getSessionToken } from "@/lib/auth/session";
import { BodyTooLargeError, readBoundedBody } from "@/lib/http/bounded-body";

function failure(status: number, code: string): NextResponse {
  return noStore(NextResponse.json({ error: { code } }, { status }));
}

/**
 * Relays an allowlisted break-glass call to the API. Access needs a session;
 * mutations need the exact public origin.
 */
async function relay(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  if (!isAllowedBreakGlassRequest(request.method, path)) return failure(404, "NOT_FOUND");

  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return failure(503, "BREAK_GLASS_UNAVAILABLE");
  }

  if (request.method !== "GET" && !hasTrustedOrigin(request, config.publicOrigin)) {
    return failure(403, "FORBIDDEN");
  }

  const token = await getSessionToken();
  if (token === null) return failure(401, "AUTH_REQUIRED");

  let body: string | undefined;
  if (request.method !== "GET") {
    try {
      body = await readBoundedBody(request);
    } catch (error) {
      return error instanceof BodyTooLargeError
        ? failure(413, "PAYLOAD_TOO_LARGE")
        : failure(400, "INVALID_REQUEST");
    }
  }

  const target = new URL(`/v1/break-glass/${path.join("/")}`, config.apiUrl);
  target.search = request.nextUrl.search;

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined || body === ""
          ? {}
          : { "content-type": request.headers.get("content-type") ?? "application/json" }),
      },
      ...(body === undefined || body === "" ? {} : { body }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return failure(503, "BREAK_GLASS_UNAVAILABLE");
  }

  const payload = await response.text();
  return noStore(
    new NextResponse(payload === "" ? null : payload, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    }),
  );
}

export const GET = relay;
export const POST = relay;
