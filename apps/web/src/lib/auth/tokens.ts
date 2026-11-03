const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isSessionToken(value: string | undefined): value is string {
  return value !== undefined && SESSION_TOKEN_PATTERN.test(value);
}

export function readLoginState(authorizationUrl: string): string | null {
  try {
    const state = new URL(authorizationUrl).searchParams.get("state");
    return isSessionToken(state ?? undefined) ? state : null;
  } catch {
    return null;
  }
}
