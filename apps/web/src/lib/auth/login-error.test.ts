import { describe, expect, test } from "bun:test";

import { loginErrorMessage } from "./login-error";

describe("loginErrorMessage", () => {
  test("maps known failures", () => {
    expect(loginErrorMessage("expired")).toContain("expired");
    expect(loginErrorMessage("unavailable")).toContain("temporarily unavailable");
  });

  test("ignores unknown, repeated and non-string values", () => {
    for (const value of ["teapot", ["expired", "denied"], null, undefined, 1]) {
      expect(loginErrorMessage(value)).toBeNull();
    }
  });
});
