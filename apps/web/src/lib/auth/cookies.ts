export const SESSION_COOKIE_NAME = "__Host-almonac_sid";
export const LOGIN_COOKIE_NAME = "__Host-almonac_login";
export const LOGIN_COOKIE_MAX_AGE_SECONDS = 600;

const BASE_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export function loginCookieOptions() {
  return { ...BASE_COOKIE, maxAge: LOGIN_COOKIE_MAX_AGE_SECONDS };
}

export function sessionCookieOptions(expiresAt: Date) {
  return { ...BASE_COOKIE, expires: expiresAt };
}

export function clearedCookieOptions() {
  return { ...BASE_COOKIE, maxAge: 0 };
}
