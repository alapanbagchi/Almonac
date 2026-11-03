"use client";

export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "AdminRequestError";
  }
}

/** Browser-side call to the administration BFF. It holds no token. */
export async function adminRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    throw new AdminRequestError(0, "ADMIN_UNAVAILABLE");
  }

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: { code?: unknown } }).error?.code ?? "ADMIN_FAILED")
        : "ADMIN_FAILED";
    throw new AdminRequestError(response.status, code);
  }
  return payload;
}
