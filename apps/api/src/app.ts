import { Elysia } from 'elysia'
import { health } from './health'
import { errors } from './plugins/errors'
import { docs } from './plugins/openapi'

/**
 * Composition root. Import this from tests and from the web client's type
 * import; `index.ts` is the only file that opens a port.
 */
export const app = new Elysia({ name: 'almonac.api' })
  .use(errors)
  .use(docs)
  .use(health)

export type App = typeof app
