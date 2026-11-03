import { describe, expect, test } from "bun:test";

import { loginFailureUrl, safeEndSessionUrl } from "./redirects";

describe("auth redirects", () => {
  test("keeps login failures on the public origin", () => {
    const url = loginFailureUrl("https://app.example", "expired");
    expect(url.origin).toBe("https://app.example");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("expired");
  });

  test("rejects an end-session target that is not plain http(s)", () => {
    const origin = "https://app.example";
    expect(safeEndSessionUrl("https://id.example/end?x=1", origin)?.hostname).toBe("id.example");
    expect(safeEndSessionUrl("javascript:alert(1)", origin)).toBeNull();
    expect(safeEndSessionUrl("https://user:pass@id.example/end", origin)).toBeNull();
    expect(safeEndSessionUrl("http://id.example/end", origin)).toBeNull();
    expect(safeEndSessionUrl("not a url", origin)).toBeNull();
    expect(safeEndSessionUrl(null, origin)).toBeNull();
  });
});
