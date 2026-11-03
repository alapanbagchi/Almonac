import { describe, expect, test } from "bun:test";

import { hasTrustedOrigin, isCrossSiteNavigation } from "./same-origin";

describe("request origin checks", () => {
  test("rejects a cross-site browser navigation", () => {
    const request = new Request("https://app.example/api/auth/login", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(isCrossSiteNavigation(request)).toBe(true);
  });

  test("allows same-origin, direct and non-browser navigations", () => {
    for (const value of ["same-origin", "none", null]) {
      const headers = value === null ? undefined : { "sec-fetch-site": value };
      expect(isCrossSiteNavigation(new Request("https://app.example/login", { headers }))).toBe(
        false,
      );
    }
  });

  test("requires an exact origin for state-changing requests", () => {
    const request = (origin?: string) =>
      new Request("https://app.example/api/auth/logout", {
        method: "POST",
        headers: origin === undefined ? undefined : { origin },
      });

    expect(hasTrustedOrigin(request("https://app.example"), "https://app.example")).toBe(true);
    expect(hasTrustedOrigin(request("https://evil.example"), "https://app.example")).toBe(false);
    expect(hasTrustedOrigin(request(), "https://app.example")).toBe(false);
  });
});
