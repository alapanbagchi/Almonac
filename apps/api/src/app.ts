import { Elysia } from 'elysia'
import type { AuthDependencies } from './auth/routes'
import { createAuth } from './auth/routes'
import { createHealth, type ReadinessCheck } from './health'
import { errors } from './plugins/errors'
import { docs } from './plugins/openapi'

export interface AppDependencies {
  readonly checkDatabase: ReadinessCheck
  readonly readinessTimeoutMs?: number
  readonly auth?: AuthDependencies
}

/**
 * Composition root. Tests build an app with a fake database check; index.ts
 * builds the real one and opens the port. Authentication routes exist only
 * when their dependencies are supplied.
 */
export function createApp({
  checkDatabase,
  readinessTimeoutMs,
  auth,
}: AppDependencies) {
  const app = new Elysia({ name: 'almonac.api' })
    .use(errors)
    .use(docs)
    .use(createHealth(checkDatabase, readinessTimeoutMs))

  return auth === undefined ? app : app.use(createAuth(auth))
}

export type App = ReturnType<typeof createApp>
