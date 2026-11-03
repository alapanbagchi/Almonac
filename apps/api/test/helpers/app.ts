import { createApp } from '../../src/app'
import type { AuthDependencies } from '../../src/auth/routes'

export function createTestApp(
  checkDatabase: () => Promise<void> = async () => {},
  readinessTimeoutMs = 50,
  auth?: AuthDependencies,
) {
  return createApp({
    checkDatabase,
    readinessTimeoutMs,
    ...(auth === undefined ? {} : { auth }),
  })
}