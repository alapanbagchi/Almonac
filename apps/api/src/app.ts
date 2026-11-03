import { Elysia } from 'elysia'
import { createHealth, type ReadinessCheck } from './health'
import { errors } from './plugins/errors'
import { docs } from './plugins/openapi'

export interface AppDependencies {
  readonly checkDatabase: ReadinessCheck
  readonly readinessTimeoutMs?: number
}

/**
 * Composition root. Tests build an app with a fake database check; index.ts
 * builds the real one and opens the port.
 */
export function createApp({
  checkDatabase,
  readinessTimeoutMs,
}: AppDependencies) {
  return new Elysia({ name: 'almonac.api' })
    .use(errors)
    .use(docs)
    .use(createHealth(checkDatabase, readinessTimeoutMs))
}

export type App = ReturnType<typeof createApp>
