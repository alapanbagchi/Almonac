import { t } from 'elysia'

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

export const uuid = t.String({ pattern: uuidPattern, maxLength: 36 })

export const breakGlassGrantBody = t.Union([
  t.Object(
    {
      hospitalId: uuid,
      mode: t.Literal('emergency'),
      reason: t.String({ minLength: 1, maxLength: 500 }),
      durationMinutes: t.Optional(t.Number({ minimum: 1, maximum: 240 })),
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      hospitalId: uuid,
      mode: t.Literal('pre_approved'),
      reason: t.String({ minLength: 1, maxLength: 500 }),
      durationMinutes: t.Optional(t.Number({ minimum: 1, maximum: 240 })),
      userId: uuid,
    },
    { additionalProperties: false },
  ),
])

export const revokeBody = t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) })

export const reviewBody = t.Object({
  decision: t.Union([
    t.Literal('upheld'),
    t.Literal('overturned'),
    t.Literal('escalated'),
  ]),
  notes: t.Optional(t.Union([t.String({ minLength: 1, maxLength: 1000 }), t.Null()])),
})

export const breakGlassGrantSchema = t.Object({
  id: t.String(),
  organisationId: t.String(),
  hospitalId: t.String(),
  userId: t.String(),
  approvedBy: t.Union([t.String(), t.Null()]),
  approvalMode: t.String(),
  reason: t.String(),
  accessLevel: t.String(),
  status: t.String(),
  startsAt: t.String(),
  endsAt: t.String(),
  approvedAt: t.String(),
  activatedAt: t.Union([t.String(), t.Null()]),
  revokedAt: t.Union([t.String(), t.Null()]),
  expiredAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
})

export const breakGlassReviewSchema = t.Object({
  id: t.String(),
  grantId: t.String(),
  reviewerId: t.String(),
  reviewedAt: t.String(),
  decision: t.String(),
  notes: t.Union([t.String(), t.Null()]),
})

export const routeDetail = (summary: string) => ({
  summary,
  tags: ['Break glass'],
  security: [{ bearerAuth: [] }],
})
