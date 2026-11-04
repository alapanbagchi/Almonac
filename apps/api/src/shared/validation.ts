import { t } from 'elysia'
import type { TSchema } from 'typebox'

/**
 * Request and response primitives shared by the admin routers. A schema is
 * the contract the route publishes, so it lives next to the routes rather
 * than in a model the service reads.
 */
const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

export const uuid = t.String({ pattern: uuidPattern, maxLength: 36 })
export const name = t.String({ minLength: 1, maxLength: 200 })
export const slug = t.String({
  minLength: 1,
  maxLength: 63,
  pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$',
})
export const reason = t.String({ minLength: 1, maxLength: 500 })

/** A registered domain: lower-case ASCII labels, at least two of them. */
export const domain = t.String({
  minLength: 4,
  maxLength: 253,
  pattern: '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$',
})

export const reasonBody = t.Object({ reason })
export const roleBody = t.Object({ roleId: uuid })
export const okSchema = t.Object({ ok: t.Boolean() })

/** A response field that is present-but-null until something fills it in. */
export const nullable = <S extends TSchema>(schema: S) => t.Union([schema, t.Null()])
export const instant = t.String({ format: 'date-time' })

export const routeDetail = (summary: string) => ({
  summary,
  tags: ['Administration'],
  security: [{ bearerAuth: [] }],
})
