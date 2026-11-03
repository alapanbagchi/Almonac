import { Elysia } from 'elysia'
import { AppError } from '../shared/errors'
import type { ErrorEnvelope } from '../shared/errors'
import { safeName } from '../shared/log'

function envelope(code: string, message: string, requestId: string): ErrorEnvelope {
  return { error: { code, message, requestId } }
}

/**
 * One response shape for every failure: `{ error: { code, message, requestId } }`.
 *
 * Registered once on the root instance; the 'global' scope makes it apply to
 * every route mounted afterwards. Error responses mint their own ID because
 * `derive` has not run when validation rejects a request.
 */
export const errors = new Elysia({ name: 'plugins.errors' })
  .derive('global', () => ({ requestId: crypto.randomUUID() }))
  .onAfterHandle('global', ({ requestId, set }) => {
    set.headers['x-request-id'] = requestId
  })
  .onError('global', ({ error, set }) => {
    const requestId = crypto.randomUUID()
    set.headers['x-request-id'] = requestId

    if (error instanceof AppError) {
      set.status = error.status
      return envelope(error.code, error.message, requestId)
    }

    // Elysia's built-in errors carry a lowercase code ('validation', 'not-found').
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code.toLowerCase()
        : undefined

    if (code === 'validation' || code === 'parse') {
      set.status = 400
      return envelope('VALIDATION_FAILED', 'Request validation failed.', requestId)
    }

    if (code === 'not-found') {
      set.status = 404
      return envelope('NOT_FOUND', 'Resource not found.', requestId)
    }

    // Log bounded class names only. Error codes and messages can contain
    // request data, so the log records whether a code exists, not its value.
    console.error(
      `[api] unhandled error requestId=${requestId} code=${code === undefined ? 'none' : 'other'} name=${safeName(error, 'Unknown')}`,
    )
    set.status = 500
    return envelope('INTERNAL', 'Unexpected server error.', requestId)
  })
