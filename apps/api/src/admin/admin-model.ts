import { t } from 'elysia'

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
export const uuid = t.String({ pattern: uuidPattern, maxLength: 36 })
export const name = t.String({ minLength: 1, maxLength: 200 })
export const slug = t.String({
  minLength: 1,
  maxLength: 63,
  pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$',
})
export const reason = t.String({ minLength: 1, maxLength: 500 })
export const listLimit = t.Optional(t.String({ pattern: '^[0-9]{1,3}$' }))

export const organisationBody = t.Object({ name, slug })
export const hospitalBody = t.Object({
  name,
  slug,
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
})
export const domainBody = t.Object({ domain: t.String({ minLength: 4, maxLength: 253 }) })
export const verifyDomainBody = t.Object({ token: t.String({ minLength: 1, maxLength: 128 }) })
export const reasonBody = t.Object({ reason })
export const roleBody = t.Object({ roleId: uuid })
export const invitationBody = t.Object({
  email: t.String({ minLength: 3, maxLength: 320 }),
  displayName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  hospitalId: t.Optional(t.Union([uuid, t.Null()])),
  roleIds: t.Array(uuid, { minItems: 1, maxItems: 16 }),
})
export const acceptBody = t.Object({ token: t.String({ minLength: 32, maxLength: 128 }) })

export const okSchema = t.Object({ ok: t.Boolean() })

export const organisationSchema = t.Object({
  id: t.String(),
  zitadelOrgId: t.Union([t.String(), t.Null()]),
  name: t.String(),
  slug: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('archived'),
  ]),
  provisionedAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
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
  primaryDomainId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
})
export const domainSchema = t.Object({
  id: t.String(),
  hospitalId: t.String(),
  domain: t.String(),
  verifiedAt: t.Union([t.String(), t.Null()]),
  retiredAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
})
export const membershipSchema = t.Object({
  id: t.String(),
  userId: t.String(),
  email: t.String(),
  displayName: t.String(),
  organisationId: t.String(),
  hospitalId: t.Union([t.String(), t.Null()]),
  status: t.Union([
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  acceptedAt: t.String(),
  endsAt: t.Union([t.String(), t.Null()]),
  roles: t.Array(t.String()),
})
export const invitationSchema = t.Object({
  id: t.String(),
  email: t.String(),
  organisationId: t.String(),
  hospitalId: t.Union([t.String(), t.Null()]),
  kind: t.Union([t.Literal('new_user'), t.Literal('existing_user')]),
  zitadelSub: t.Union([t.String(), t.Null()]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('accepted'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  expiresAt: t.String(),
  createdAt: t.String(),
  acceptedAt: t.Union([t.String(), t.Null()]),
  acceptedByUserId: t.Union([t.String(), t.Null()]),
  invitedBy: t.String(),
  roleIds: t.Array(t.String()),
})
export const auditSchema = t.Object({
  id: t.String(),
  occurredAt: t.String(),
  actorType: t.Union([
    t.Literal('user'),
    t.Literal('system'),
    t.Literal('service'),
    t.Literal('break_glass'),
  ]),
  actorUserId: t.Union([t.String(), t.Null()]),
  sessionId: t.Union([t.String(), t.Null()]),
  organisationId: t.Union([t.String(), t.Null()]),
  hospitalId: t.Union([t.String(), t.Null()]),
  eventType: t.String(),
  outcome: t.Union([t.Literal('success'), t.Literal('failure'), t.Literal('denied')]),
  targetType: t.Union([t.String(), t.Null()]),
  targetId: t.Union([t.String(), t.Null()]),
  requestId: t.Union([t.String(), t.Null()]),
  reasonCode: t.Union([t.String(), t.Null()]),
  metadata: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean(), t.Null()])),
})

export const routeDetail = (summary: string) => ({
  summary,
  tags: ['Administration'],
  security: [{ bearerAuth: [] }],
})

export function limitOf(value: string | undefined): number {
  if (value === undefined) return 50
  const limit = Number(value)
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 50
}
