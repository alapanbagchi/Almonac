import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { AuthApiError, createAuthApi } = await import("./api");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("auth API client", () => {
  test("starts a login and returns the authorization URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return json({
          authorizationUrl: "https://id.example/authorize?state=abc",
          expiresAt: "2030-01-01T00:00:00.000Z",
        });
      },
    });

    const result = await api.startLogin("/dashboard");
    expect(result.authorizationUrl).toBe("https://id.example/authorize?state=abc");
    expect(result.expiresAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));
    expect(calls[0]?.url).toBe("http://api.example/v1/auth/login-attempts");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ returnTo: "/dashboard" }));
    expect(calls[0]?.init?.cache).toBe("no-store");
  });

  test("rejects a callback return target that points off-site", async () => {
    const api = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async () =>
        json({
          token: "a".repeat(43),
          expiresAt: "2030-01-01T00:00:00.000Z",
          returnTo: "https://evil.example",
        }),
    });

    await expect(api.completeLogin("code", "b".repeat(43))).rejects.toThrow();
  });

  test("treats a rejected session as signed out and other failures as errors", async () => {
    const unauthorized = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async () => json({ error: { code: "AUTH_FAILED", message: "no", requestId: "r" } }, 401),
    });
    expect(await unauthorized.getSession("a".repeat(43))).toBeNull();

    const unavailable = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async () => json({ error: { code: "AUTH_UNAVAILABLE", message: "no", requestId: "r" } }, 503),
    });
    await expect(unavailable.getSession("a".repeat(43))).rejects.toMatchObject({
      name: "AuthApiError",
      status: 503,
      code: "AUTH_UNAVAILABLE",
    });
  });

  test("fails closed on a malformed successful response", async () => {
    const api = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async () => json({ endSessionUrl: "not a url" }),
    });
    await expect(api.logout("a".repeat(43))).rejects.toMatchObject({ status: 502 });
  });

  test("surfaces a network failure without leaking it", async () => {
    const api = createAuthApi({
      baseUrl: "http://api.example",
      fetch: async () => {
        throw new Error("socket closed at 10.0.0.1");
      },
    });
    await expect(api.startLogin("/")).rejects.toBeInstanceOf(AuthApiError);
  });
});
