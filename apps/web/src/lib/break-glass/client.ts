export class BreakGlassRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Break-glass request failed",
  ) {
    super(message);
    this.name = "BreakGlassRequestError";
  }
}

/** Browser helper for the same-origin break-glass relay. It never sees a token. */
export async function breakGlassRequest(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`/api/break-glass/${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "code" in payload.error &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : "BREAK_GLASS_UNAVAILABLE";
    throw new BreakGlassRequestError(response.status, code);
  }
  return payload;
}
