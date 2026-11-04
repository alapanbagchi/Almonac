export interface CredentialOutcome {
  readonly redirectUrl?: string;
  readonly status?: string;
  readonly message?: string;
}

/**
 * Post a credential form to the BFF. The password never leaves this request
 * body: the response only carries the provider callback to navigate to.
 */
export async function submitCredentials(
  path: string,
  body: unknown,
): Promise<CredentialOutcome> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { message: "The service did not respond. Try again shortly." };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    const redirectUrl = readString(payload, "redirectUrl");
    if (redirectUrl !== null) return { redirectUrl };
    const status = readString(payload, "status");
    if (status !== null) return { status };
    return { message: "The sign-in response was not valid." };
  }

  const error = readError(payload);
  return {
    message: error?.message ?? "The request could not be completed. Try again shortly.",
  };
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function readError(value: unknown): { code: string; message: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.message !== "string") return null;
  return { code: record.code, message: record.message };
}
