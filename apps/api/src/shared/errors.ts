/** The one failure shape every route returns. */
export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    requestId: string
  }
}

/**
 * A failure the API knows how to answer with.
 *
 * Services throw this; the root error plugin maps it to the response envelope.
 * Messages are public, so they must never contain SQL, stack traces or PHI.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
