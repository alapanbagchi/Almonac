import { openapi } from '@elysia/openapi'

/**
 * OpenAPI is generated from the route schemas at `/openapi/json` and served by
 * Scalar at `/openapi`. Registered once, on the root instance.
 */
export const docs = openapi({
  documentation: {
    info: {
      title: 'Almonac API',
      version: '0.0.0',
    },
  },
})
