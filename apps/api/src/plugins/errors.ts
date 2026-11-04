import { Elysia } from 'elysia'
import type { ErrorEnvelope } from '../shared/errors'
import { AppError } from '../shared/errors'
import { safeName } from '../shared/log'
import { requestIdOf } from '../shared/request'

function envelope(code: string, message: string, requestId: string): ErrorEnvelope {
  return { error: { code, message, requestId } }
}

/**
 * One response shape for every failure: `{ error: { code, message, requestId } }`.
 *
 * Registered once on the root instance; the 'global' scope makes it apply to
 * every route mounted afterwards. A handler error keeps its derived request
 * ID; validation can fail before `derive` runs, so the fallback mints one.
 */
export const errors = new Elysia({ name: 'plugins.errors' })
  .derive('global', () => ({ requestId: crypto.randomUUID() }))
  .onAfterHandle('global', ({ requestId, set }) => {
    set.headers['x-request-id'] = requestId
  })
  .onError('global', (context) => {
    const { error, set } = context
    const requestId = requestIdOf(context)
    set.headers['x-request-id'] = requestId

    const failure = failureOf(error, requestId)
    set.status = failure.status
    for (const [name, value] of Object.entries(failure.headers ?? {})) {
      set.headers[name] = value
    }
    return failure.body
  })

interface Failure {
  readonly status: number
  readonly body: ErrorEnvelope
  readonly headers?: Readonly<Record<string, string>>
}

/** How each thrown error is answered. */
function failureOf(error: unknown, requestId: string): Failure {
  if (error instanceof AppError) {
    return {
      status: error.status,
      headers: error.headers,
      body: envelope(error.code, error.message, requestId),
    }
  }

  // Elysia's built-in errors carry a lowercase code.
  const code = providerCode(error)

  if (code === 'validation' || code === 'parse') {
    return {
      status: 400,
      body: envelope('VALIDATION_FAILED', 'Request validation failed.', requestId),
    }
  }

  if (code === 'not-found') {
    return { status: 404, body: envelope('NOT_FOUND', 'Resource not found.', requestId) }
  }

  // Log bounded class names only. Error codes and messages can contain
  // request data, so the log records whether a code exists, not its value.
  console.error(
    `[api] unhandled error requestId=${requestId} code=${code === undefined ? 'none' : 'other'} name=${safeName(error, 'Unknown')}`,
  )
  return { status: 500, body: envelope('INTERNAL', 'Unexpected server error.', requestId) }
}

function providerCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code.toLowerCase()
    : undefined
}
