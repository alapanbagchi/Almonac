import { describe, expect, test } from "bun:test";

import { isAllowedBreakGlassRequest } from "./allowlist";

const GRANT = "00000000-0000-4000-8000-000000000007";

describe("break-glass allowlist", () => {
  test("accepts the calls the screen makes", () => {
    expect(isAllowedBreakGlassRequest("GET", ["grants"])).toBe(true);
    expect(isAllowedBreakGlassRequest("POST", ["grants"])).toBe(true);
    expect(isAllowedBreakGlassRequest("POST", ["grants", GRANT, "revoke"])).toBe(true);
    expect(isAllowedBreakGlassRequest("POST", ["grants", GRANT, "review"])).toBe(true);
  });

  test("rejects unknown calls, identifiers and methods", () => {
    expect(isAllowedBreakGlassRequest("DELETE", ["grants"])).toBe(false);
    expect(isAllowedBreakGlassRequest("POST", ["grants", GRANT, "delete"])).toBe(false);
    expect(isAllowedBreakGlassRequest("POST", ["grants", "../admin", "revoke"])).toBe(false);
    expect(isAllowedBreakGlassRequest("GET", ["grants", GRANT, "revoke"])).toBe(false);
    expect(isAllowedBreakGlassRequest("POST", [])).toBe(false);
  });
});
