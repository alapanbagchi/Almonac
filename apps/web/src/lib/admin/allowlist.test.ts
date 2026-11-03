import { describe, expect, test } from "bun:test";

import { isAllowedAdminRequest } from "./allowlist";

const ID = "11111111-1111-4111-8111-111111111111";

describe("administration allowlist", () => {
  test("accepts the routes the admin screens use", () => {
    expect(isAllowedAdminRequest("GET", ["organisations"])).toBe(true);
    expect(isAllowedAdminRequest("POST", ["organisations"])).toBe(true);
    expect(isAllowedAdminRequest("GET", ["organisations", ID, "hospitals"])).toBe(true);
    expect(isAllowedAdminRequest("POST", ["hospitals", ID, "domains"])).toBe(true);
    expect(isAllowedAdminRequest("DELETE", ["memberships", ID, "roles", ID])).toBe(true);
    expect(isAllowedAdminRequest("POST", ["invitations", "accept"])).toBe(true);
  });

  test("rejects unknown methods, paths and traversal", () => {
    expect(isAllowedAdminRequest("PUT", ["organisations"])).toBe(false);
    expect(isAllowedAdminRequest("GET", ["secrets"])).toBe(false);
    expect(isAllowedAdminRequest("GET", ["organisations", ID, "..", "secrets"])).toBe(false);
    expect(isAllowedAdminRequest("GET", ["organisations", ID, "hospitals", ID])).toBe(false);
    expect(isAllowedAdminRequest("POST", ["invitations", ID, "accept"])).toBe(false);
  });
});
