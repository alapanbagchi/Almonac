/** The one failure shape every route returns. */
export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    requestId: string
  }
}

export interface AppErrorOptions extends ErrorOptions {
  /** Response headers this failure requires, such as Retry-After. */
  headers?: Readonly<Record<string, string>>
}

/**
 * A failure the API knows how to answer with.
 *
 * Services throw this; the root error plugin maps it to the response envelope.
 * Messages are public, so they must never contain SQL, stack traces or PHI.
 */
export class AppError extends Error {
  readonly headers: Readonly<Record<string, string>>

  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    options?: AppErrorOptions,
  ) {
    super(message, options)
    this.name = 'AppError'
    this.headers = options?.headers ?? {}
  }
}

/**
 * The canonical failures. One code per status keeps the public contract small:
 * a feature describes what went wrong in the message, never in a new code.
 */
export const unauthenticated = (message: string): AppError =>
  new AppError('UNAUTHENTICATED', 401, message)
export const forbidden = (): AppError =>
  new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
export const notFound = (message: string): AppError => new AppError('NOT_FOUND', 404, message)
export const conflict = (message: string): AppError => new AppError('CONFLICT', 409, message)
export const ruleViolation = (message: string): AppError => new AppError('RULE_VIOLATION', 422, message)
export const unavailable = (message: string): AppError => new AppError('UNAVAILABLE', 503, message)

/**
 * A database constraint the API answers with a 409. A repository translates the
 * SQLSTATE and says what it means; the service, which owns policy, decides how
 * (or whether) to answer.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** A rule the request breaks, answered with a 422. Same split as ConflictError. */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleViolation'
  }
}
