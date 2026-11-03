import { describe, expect, test } from "bun:test";

import { isSessionToken, readLoginState } from "./tokens";

describe("auth tokens", () => {
  test("accepts only a 32-byte base64url token", () => {
    expect(isSessionToken("a".repeat(43))).toBe(true);
    expect(isSessionToken("a".repeat(42))).toBe(false);
    expect(isSessionToken("a".repeat(44))).toBe(false);
    expect(isSessionToken(`${"a".repeat(42)}=`)).toBe(false);
    expect(isSessionToken(undefined)).toBe(false);
  });

  test("reads a bounded state from the authorization URL", () => {
    expect(readLoginState(`https://id.example/authorize?state=${"a".repeat(43)}`)).toBe(
      "a".repeat(43),
    );
    expect(readLoginState("https://id.example/authorize?state=short")).toBeNull();
    expect(readLoginState("not a url")).toBeNull();
  });
});
