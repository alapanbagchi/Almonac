export interface PolicyOptions {
  development: boolean;
  secureOrigin: boolean;
  /** Origin of the identity provider, which receives the sign-out redirect. */
  idpOrigin?: string | null;
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  // same-origin keeps the Origin header on form submissions, which the BFF
  // uses to reject cross-site writes. It still hides the URL from other sites.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export function contentSecurityPolicy(
  nonce: string,
  options: PolicyOptions,
): string {
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${["'self'", ...(options.idpOrigin ? [options.idpOrigin] : [])].join(" ")}`,
    "frame-ancestors 'none'",
    ...(options.secureOrigin ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}
