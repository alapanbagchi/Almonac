import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isAllowedAdminRequest } from "@/lib/admin/allowlist";
import { loadWebConfig, type WebConfig } from "@/lib/auth/config";
import { noStore } from "@/lib/auth/responses";
import { hasTrustedOrigin } from "@/lib/auth/same-origin";
import { getSessionToken } from "@/lib/auth/session";

const MAX_BODY_BYTES = 8_192;

class BodyTooLargeError extends Error {}

/** Reads at most MAX_BODY_BYTES, so an unauthenticated caller cannot stream
 * an unbounded body through the BFF. */
async function readBoundedBody(request: NextRequest): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Relays an allowlisted administration call to the API. The browser never
 * receives the session token, the API base URL or a writable database path.
 */
async function relay(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  if (!isAllowedAdminRequest(request.method, path)) {
    return noStore(NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
  }

  let config: WebConfig;
  try {
    config = loadWebConfig();
  } catch {
    return noStore(
      NextResponse.json({ error: { code: "ADMIN_UNAVAILABLE" } }, { status: 503 }),
    );
  }

  if (request.method !== "GET" && !hasTrustedOrigin(request, config.publicOrigin)) {
    return noStore(NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }));
  }

  const token = await getSessionToken();
  if (token === null) {
    return noStore(
      NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }),
    );
  }

  let body: string | undefined;
  if (request.method !== "GET") {
    try {
      body = await readBoundedBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return noStore(
          NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 }),
        );
      }
      return noStore(
        NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 }),
      );
    }
  }

  const target = new URL(`/v1/admin/${path.join("/")}`, config.apiUrl);
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
    return noStore(
      NextResponse.json({ error: { code: "ADMIN_UNAVAILABLE" } }, { status: 503 }),
    );
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
export const DELETE = relay;
