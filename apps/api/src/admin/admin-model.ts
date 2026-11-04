import { t } from 'elysia'
import type { TSchema } from 'typebox'

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
const domain = t.String({
  minLength: 4,
  maxLength: 253,
  pattern: '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$',
})

export const organisationBody = t.Object({ name, slug })
export const hospitalBody = t.Object({
  name,
  slug,
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
})
export const domainBody = t.Object({ domain })
export const verifyDomainBody = t.Object({ token: t.String({ minLength: 1, maxLength: 128 }) })
export const reasonBody = t.Object({ reason })
export const roleBody = t.Object({ roleId: uuid })
export const invitationBody = t.Object({
  email: t.String({ minLength: 3, maxLength: 320 }),
  displayName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  hospitalId: t.Optional(uuid),
  roleIds: t.Array(uuid, { minItems: 1, maxItems: 16 }),
})
export const acceptBody = t.Object({ token: t.String({ minLength: 32, maxLength: 128 }) })

/** A response field that is present-but-null until something fills it in. */
const nullable = <S extends TSchema>(schema: S) => t.Union([schema, t.Null()])
const instantSchema = t.String({ format: 'date-time' })

export const okSchema = t.Object({ ok: t.Boolean() })

export const organisationSchema = t.Object({
  id: t.String(),
  zitadelOrgId: nullable(t.String()),
  name: t.String(),
  slug: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('archived'),
  ]),
  provisionedAt: nullable(instantSchema),
  createdAt: instantSchema,
})
export const hospitalSchema = t.Object({
  id: t.String(),
  organisationId: t.String(),
  name: t.String(),
  slug: t.String(),
  timezone: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('closed'),
  ]),
  primaryDomainId: nullable(t.String()),
  createdAt: instantSchema,
})
export const domainSchema = t.Object({
  id: t.String(),
  hospitalId: t.String(),
  domain: t.String(),
  verifiedAt: nullable(instantSchema),
  retiredAt: nullable(instantSchema),
  createdAt: instantSchema,
})
export const roleSchema = t.Object({
  id: t.String(),
  key: t.String(),
  name: t.String(),
  scope: t.Union([t.Literal('organisation'), t.Literal('hospital')]),
  permissions: t.Array(t.String()),
})
export const membershipSchema = t.Object({
  id: t.String(),
  userId: t.String(),
  email: t.String(),
  displayName: t.String(),
  organisationId: t.String(),
  hospitalId: nullable(t.String()),
  status: t.Union([
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  acceptedAt: instantSchema,
  endsAt: nullable(instantSchema),
  roles: t.Array(t.String()),
})
export const invitationSchema = t.Object({
  id: t.String(),
  email: t.String(),
  organisationId: t.String(),
  hospitalId: nullable(t.String()),
  kind: t.Union([t.Literal('new_user'), t.Literal('existing_user')]),
  zitadelSub: nullable(t.String()),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('accepted'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  expiresAt: instantSchema,
  createdAt: instantSchema,
  acceptedAt: nullable(instantSchema),
  acceptedByUserId: nullable(t.String()),
  invitedBy: t.String(),
  roleIds: t.Array(t.String()),
})
export const auditSchema = t.Object({
  id: t.String(),
  occurredAt: instantSchema,
  actorType: t.Union([
    t.Literal('user'),
    t.Literal('system'),
    t.Literal('service'),
    t.Literal('break_glass'),
  ]),
  actorUserId: nullable(t.String()),
  sessionId: nullable(t.String()),
  organisationId: nullable(t.String()),
  hospitalId: nullable(t.String()),
  eventType: t.String(),
  outcome: t.Union([t.Literal('success'), t.Literal('failure'), t.Literal('denied')]),
  targetType: nullable(t.String()),
  targetId: nullable(t.String()),
  requestId: nullable(t.String()),
  reasonCode: nullable(t.String()),
  metadata: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
})

export const routeDetail = (summary: string) => ({
  summary,
  tags: ['Administration'],
  security: [{ bearerAuth: [] }],
})
