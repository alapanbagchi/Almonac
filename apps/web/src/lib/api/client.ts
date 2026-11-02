import 'server-only'

import { treaty } from '@elysia/eden'

import type { App } from '../../../../api/src/app'

/**
 * The one Eden client for the Almonac API.
 *
 * Types come from the API's exported `App`, so a route change breaks this
 * compile instead of drifting. Server-only: the browser never talks to the API
 * directly, and never holds its credentials.
 */
export const api = treaty<App>(process.env.API_URL ?? 'http://localhost:3001')

export type { ErrorEnvelope } from '../../../../api/src/shared/errors'
