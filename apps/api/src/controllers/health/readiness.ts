import { safeName } from '../../shared/log'

export type ReadinessCheck = () => Promise<void>

export interface HealthDependencies {
  readonly checkDatabase: ReadinessCheck
  readonly timeoutMs?: number
}

const READINESS_TIMEOUT_MS = 2_000

/**
 * Readiness is a fixed, bounded database check; it never returns the driver
 * error, the connection string or a stack trace.
 */
export async function readiness(dependencies: HealthDependencies) {
  try {
    await withTimeout(
      dependencies.checkDatabase(),
      dependencies.timeoutMs ?? READINESS_TIMEOUT_MS,
    )
    return { status: 'ok' as const }
  } catch (error) {
    console.error('[api] readiness check failed:', safeName(error))
    return { status: 'unavailable' as const }
  }
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
