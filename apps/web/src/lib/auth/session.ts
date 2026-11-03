import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createAuthApi, type AuthSession } from "./api";
import { loadWebConfig } from "./config";
import { SESSION_COOKIE_NAME } from "./cookies";
import { isSessionToken } from "./tokens";

/** The opaque session token, or null when the browser has no valid cookie. */
export const getSessionToken = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return isSessionToken(token) ? token : null;
});

/**
 * The API owns the session. This reads the opaque cookie and asks the API on
 * every request; it never trusts the cookie's contents.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const token = await getSessionToken();
  if (token === null) return null;

  const config = loadWebConfig();
  return createAuthApi({ baseUrl: config.apiUrl }).getSession(token);
});
