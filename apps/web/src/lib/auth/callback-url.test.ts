import { describe, expect, test } from "bun:test";

import { readCallback } from "./callback-url";

const ORIGIN = "https://app.almonac.example";
const STATE = "a".repeat(43);

function callback(query: string): string {
  return `${ORIGIN}/api/auth/callback?${query}`;
}

describe("readCallback", () => {
  test("accepts a callback for this origin", () => {
    const value = callback(`code=abc&state=${STATE}`);

    expect(readCallback(value, ORIGIN)).toEqual({ url: value, state: STATE });
  });

  test("rejects another origin or path", () => {
    expect(readCallback(callback(`code=abc&state=${STATE}`).replace(ORIGIN, "https://evil.example"), ORIGIN)).toBeNull();
    expect(readCallback(`${ORIGIN}/login/api/auth/callback?code=abc&state=${STATE}`, ORIGIN)).toBeNull();
  });

  test("rejects a malformed state or missing code", () => {
    expect(readCallback(callback("code=abc&state=short"), ORIGIN)).toBeNull();
    expect(readCallback(callback(`code=abc&state=${STATE}x`), ORIGIN)).toBeNull();
    expect(readCallback(callback(`state=${STATE}`), ORIGIN)).toBeNull();
  });

  test("rejects an oversized code", () => {
    expect(readCallback(callback(`code=${"c".repeat(4097)}&state=${STATE}`), ORIGIN)).toBeNull();
  });
});
