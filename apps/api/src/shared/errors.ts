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
