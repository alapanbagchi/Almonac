import { Elysia } from 'elysia'
import { healthResponse, readyResponse, unavailableResponse } from './model'

export type ReadinessCheck = () => Promise<void>

const READINESS_TIMEOUT_MS = 2_000

/**
 * Liveness and readiness probes. Readiness is a fixed, bounded database check;
 * it never returns the driver error, the connection string or a stack trace.
 */
export function createHealth(
  checkDatabase: ReadinessCheck,
  timeoutMs = READINESS_TIMEOUT_MS,
) {
  return new Elysia({
    name: 'system.health',
    prefix: '/health',
    tags: ['System'],
  })
    .get(
      '',
      {
        response: { 200: healthResponse },
        detail: {
          summary: 'Liveness probe',
          tags: ['System'],
          security: [],
        },
      },
      () => ({ status: 'ok' as const }),
    )
    .get(
      '/ready',
      {
        response: { 200: readyResponse, 503: unavailableResponse },
        detail: {
          summary: 'Readiness probe',
          tags: ['System'],
          security: [],
        },
      },
      async ({ set }) => {
        try {
          await withTimeout(checkDatabase(), timeoutMs)
          return { status: 'ok' as const }
        } catch (error) {
          set.status = 503
          const name = error instanceof Error ? error.name : ''
          const safeName =
            name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'unknown'
          console.error('[api] readiness check failed:', safeName)
          return { status: 'unavailable' as const }
        }
      },
    )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('readiness timeout')), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
