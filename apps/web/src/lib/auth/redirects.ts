export const LOGIN_FAILURES = [
  "denied",
  "expired",
  "failed",
  "invalid",
  "unavailable",
] as const;

export type LoginFailure = (typeof LOGIN_FAILURES)[number];

export function loginFailureUrl(origin: string, failure: LoginFailure): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("error", failure);
  return url;
}

export const STEP_UP_FAILURES = ["denied", "failed", "invalid", "session", "unavailable"] as const;

export type StepUpFailure = (typeof STEP_UP_FAILURES)[number];

/** Returns to the page that asked for a fresh check, with a bounded reason. */
export function stepUpFailureUrl(
  origin: string,
  returnTo: string,
  failure: StepUpFailure,
): URL {
  const url = new URL(returnTo, origin);
  url.searchParams.set("stepUp", failure);
  return url;
}

/** Only an absolute URL with the public origin's protocol and no credentials may leave. */
export function safeEndSessionUrl(value: string | null, publicOrigin: string): URL | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    const expectedProtocol = new URL(publicOrigin).protocol;
    if (url.protocol !== expectedProtocol || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
