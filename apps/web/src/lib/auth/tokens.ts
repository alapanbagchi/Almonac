const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isSessionToken(value: string | undefined): value is string {
  return value !== undefined && SESSION_TOKEN_PATTERN.test(value);
}
