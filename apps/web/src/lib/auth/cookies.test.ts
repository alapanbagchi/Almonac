import { describe, expect, test } from "bun:test";

import {
  clearedCookieOptions,
  LOGIN_COOKIE_MAX_AGE_SECONDS,
  loginCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./cookies";

describe("auth cookies", () => {
  test("uses host-prefixed names", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-almonac_sid");
  });

  test("sets the protective attributes on every cookie", () => {
    const expires = new Date("2030-01-01T00:00:00Z");
    for (const options of [
      loginCookieOptions(),
      sessionCookieOptions(expires),
      clearedCookieOptions(),
    ]) {
      expect(options).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
      expect(options).not.toHaveProperty("domain");
    }
  });

  test("bounds the login binding and expires the session with the token", () => {
    expect(loginCookieOptions().maxAge).toBe(LOGIN_COOKIE_MAX_AGE_SECONDS);
    expect(sessionCookieOptions(new Date("2030-01-01T00:00:00Z")).expires).toEqual(
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(clearedCookieOptions().maxAge).toBe(0);
  });
});
