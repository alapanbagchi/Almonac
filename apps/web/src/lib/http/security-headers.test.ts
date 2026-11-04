import { describe, expect, test } from "bun:test";

import {
  SECURITY_HEADERS,
  contentSecurityPolicy,
} from "./security-headers";

const NONCE = "dGVzdC1ub25jZQ==";

function policy(options: { development: boolean; secureOrigin: boolean }): string {
  return contentSecurityPolicy(NONCE, options);
}

describe("content security policy", () => {
  test("binds scripts to the nonce and dynamic imports", () => {
    const value = policy({ development: false, secureOrigin: true });

    const script =
      value.split(";").find((part) => part.trim().startsWith("script-src")) ??
      "";

    expect(script).toContain(`'nonce-${NONCE}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  test("allows the provider origin for the sign-out redirect", () => {
    const value = contentSecurityPolicy(NONCE, {
      development: false,
      secureOrigin: true,
      idpOrigin: "https://id.example",
    });

    expect(value).toContain("form-action 'self' https://id.example");
  });

  test("allows the React development build to evaluate code", () => {
    expect(policy({ development: true, secureOrigin: false })).toContain(
      "'unsafe-eval'",
    );
  });

  test("upgrades insecure requests only for an https origin", () => {
    expect(policy({ development: false, secureOrigin: true })).toContain(
      "upgrade-insecure-requests",
    );
    expect(policy({ development: false, secureOrigin: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  test("blocks framing, objects and foreign origins", () => {
    const value = policy({ development: false, secureOrigin: false });

    expect(value).toContain("default-src 'self'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("frame-ancestors 'none'");
    expect(value).toContain("form-action 'self'");
    expect(value).toContain("base-uri 'self'");
    expect(SECURITY_HEADERS["x-frame-options"]).toBe("DENY");
    expect(SECURITY_HEADERS["referrer-policy"]).toBe("same-origin");
  });
});
