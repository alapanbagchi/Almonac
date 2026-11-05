/** A server action never throws across the boundary; it returns a safe code. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string };

export class AdminActionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AdminActionError";
  }
}

/** Turn a failed action result into the rejection a query or mutation expects. */
export async function unwrapAction<T>(
  result: Promise<ActionResult<T>>,
): Promise<T> {
  const value = await result;
  if (!value.ok) throw new AdminActionError(value.code);
  return value.data;
}

/** A safe message for a failed write; forms can map a conflict before this. */
export function actionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AdminActionError)) return fallback;
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "UNAUTHENTICATED":
      return "Your session ended. Sign in again.";
    case "FORBIDDEN":
      return "Your account cannot do that.";
    case "VALIDATION_FAILED":
      return "Check the form and try again.";
    case "ADMIN_UNAVAILABLE":
      return "The service did not respond. Try again shortly.";
    default:
      return fallback;
  }
}

/** A safe message for a failed read. The API's own text never reaches the UI. */
export function queryErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AdminActionError)) return fallback;
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "UNAUTHENTICATED":
      return "Your session ended. Sign in again.";
    case "FORBIDDEN":
      return "Your account cannot view this.";
    case "ADMIN_UNAVAILABLE":
      return "The service did not respond. Try again shortly.";
    case "ADMIN_INVALID_RESPONSE":
      return "The service returned an unexpected response.";
    default:
      return fallback;
  }
}
