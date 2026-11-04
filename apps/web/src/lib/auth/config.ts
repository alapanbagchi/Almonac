export interface WebConfig {
  readonly apiUrl: string;
  readonly publicOrigin: string;
  /** Identity provider origin that ends the single sign-on session. */
  readonly idpOrigin: string;
}

export class WebConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid web configuration:\n- ${issues.join("\n- ")}`);
    this.name = "WebConfigError";
  }
}

/**
 * Server-only configuration. Both values are origins: a path, credentials,
 * query or fragment is rejected so callers cannot smuggle a redirect target.
 */
export function loadWebConfig(
  env: Record<string, string | undefined> = process.env,
): WebConfig {
  const issues: string[] = [];
  const production = env.NODE_ENV === "production";

  const apiUrl = readOrigin(
    env.API_URL ?? (production ? "" : "http://localhost:3001"),
    "API_URL",
    production,
    issues,
  );
  const publicOrigin = readOrigin(
    env.AUTH_PUBLIC_ORIGIN ?? (production ? "" : "http://localhost:3000"),
    "AUTH_PUBLIC_ORIGIN",
    production,
    issues,
  );
  const idpOrigin = readOrigin(
    env.AUTH_IDP_ORIGIN ?? (production ? "" : "http://localhost:8080"),
    "AUTH_IDP_ORIGIN",
    production,
    issues,
  );

  if (
    issues.length > 0 ||
    apiUrl === undefined ||
    publicOrigin === undefined ||
    idpOrigin === undefined
  ) {
    throw new WebConfigError(issues);
  }
  return { apiUrl, publicOrigin, idpOrigin };
}

/**
 * Parses an http(s) origin without reporting issues. The proxy uses it for the
 * content security policy, where an invalid value must only narrow the policy.
 */
export function readOptionalOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function readOrigin(
  value: string,
  name: string,
  production: boolean,
  issues: string[],
): string | undefined {
  if (value.trim() === "") {
    issues.push(`${name} is required.`);
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push(`${name} must be a valid absolute URL.`);
    return undefined;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    issues.push(`${name} must be an http(s) origin without credentials, path, query or fragment.`);
    return undefined;
  }

  if (production && url.protocol !== "https:") {
    issues.push(`${name} must use https in production.`);
    return undefined;
  }

  return url.origin;
}
