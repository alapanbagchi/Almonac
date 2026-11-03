import { describe, expect, test } from "bun:test";

import { InvalidReturnToError, normaliseReturnTo } from "./return-to";

describe("normaliseReturnTo", () => {
  test("defaults to the dashboard root", () => {
    expect(normaliseReturnTo(undefined)).toBe("/");
    expect(normaliseReturnTo(null)).toBe("/");
  });

  test("accepts an internal path with a query", () => {
    expect(normaliseReturnTo("/dashboard/users?page=2")).toBe("/dashboard/users?page=2");
  });

  test("rejects external, protocol-relative and escaped targets", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/%2f%2fevil.example",
      "/%5c%5cevil.example",
      "/%00",
      "/\u0000",
      "",
      "   ",
      `/${"a".repeat(2_048)}`,
      42,
    ]) {
      expect(() => normaliseReturnTo(value)).toThrow(InvalidReturnToError);
    }
  });
});
