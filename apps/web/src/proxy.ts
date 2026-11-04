import { NextResponse, type NextRequest } from "next/server";

import {
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  contentSecurityPolicy,
} from "@/lib/http/security-headers";

const development = process.env.NODE_ENV === "development";
const secureOrigin = process.env.AUTH_PUBLIC_ORIGIN?.startsWith("https://") ?? false;

/**
 * A nonce lets the application run with no 'unsafe-inline' script source.
 * Next.js reads the nonce from this request header and stamps its own scripts.
 * A page must render per request for the nonce to reach its HTML.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, { development, secureOrigin });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (secureOrigin) {
    response.headers.set("strict-transport-security", STRICT_TRANSPORT_SECURITY);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Prefetches fetch an RSC payload, not HTML, and must not warm a
      // response that carries a per-request nonce.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
