import { Elysia, t } from 'elysia'
import { authenticateBearer, type SessionAuthenticator } from '../guards/bearer'
import { pageLimit, pageOffset, pageSchema } from '../shared/pagination'
import { requestContext, requestIdOf, type RequestServer } from '../shared/request'
import { activateGrant } from '../controllers/break-glass/activate-grant'
import { listGrants } from '../controllers/break-glass/list-grants'
import { requestGrant } from '../controllers/break-glass/request-grant'
import { reviewGrant } from '../controllers/break-glass/review-grant'
import { revokeGrant } from '../controllers/break-glass/revoke-grant'
import type { BreakGlassContext, BreakGlassDependencies } from '../controllers/break-glass/support'

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

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

export const grantListQuery = t.Object({
  hospitalId: t.Optional(uuid),
  limit: pageLimit,
  offset: pageOffset,
})

export const revokeBody = t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) })

export const reviewBody = t.Object({
  decision: t.Union([t.Literal('upheld'), t.Literal('overturned'), t.Literal('escalated')]),
  notes: t.Optional(t.Union([t.String({ minLength: 1, maxLength: 1000 }), t.Null()])),
})

export const breakGlassGrantSchema = t.Object({
  id: t.String(),
  organisationId: t.String(),
  hospitalId: t.String(),
  userId: t.String(),
  approvedBy: t.Union([t.String(), t.Null()]),
  approvalMode: t.Union([t.Literal('pre_approved'), t.Literal('emergency')]),
  reason: t.String(),
  accessLevel: t.Literal('read_only'),
  status: t.Union([
    t.Literal('approved'),
    t.Literal('active'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
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
  decision: t.Union([t.Literal('upheld'), t.Literal('overturned'), t.Literal('escalated')]),
  notes: t.Union([t.String(), t.Null()]),
})

export const routeDetail = (summary: string) => ({
  summary,
  tags: ['Break glass'],
  security: [{ bearerAuth: [] }],
})

export interface BreakGlassRouterDependencies extends BreakGlassDependencies {
  readonly sessions: SessionAuthenticator
}

/**
 * Time-boxed emergency access. The controller re-checks permission,
 * membership and assurance; the response never substitutes for a clinical
 * authorisation.
 */
export function breakGlassRouter(dependencies: BreakGlassRouterDependencies) {
  return new Elysia({
    name: 'break-glass.routes',
    prefix: '/v1/break-glass',
    tags: ['Break glass'],
  })
    .derive(async (context) => ({
      breakGlassContext: await resolveContext(dependencies, context),
    }))
    .post(
      '/grants',
      {
        body: breakGlassGrantBody,
        response: { 201: breakGlassGrantSchema },
        detail: routeDetail('Request emergency access'),
      },
      async (context) => {
        const grant = await requestGrant(
          dependencies,
          context.breakGlassContext,
          context.body,
        )
        context.set.status = 201
        return grant
      },
    )
    .get(
      '/grants',
      {
        query: grantListQuery,
        response: { 200: pageSchema(breakGlassGrantSchema) },
        detail: routeDetail('List emergency access grants'),
      },
      async (context) => listGrants(dependencies, context.breakGlassContext, context.query),
    )
    .post(
      '/grants/:grantId/activate',
      {
        params: t.Object({ grantId: uuid }),
        response: { 200: breakGlassGrantSchema },
        detail: routeDetail('Activate an approved grant'),
      },
      async (context) =>
        activateGrant(dependencies, context.breakGlassContext, context.params.grantId),
    )
    .post(
      '/grants/:grantId/revoke',
      {
        params: t.Object({ grantId: uuid }),
        body: revokeBody,
        response: { 200: breakGlassGrantSchema },
        detail: routeDetail('Revoke emergency access'),
      },
      async (context) =>
        revokeGrant(
          dependencies,
          context.breakGlassContext,
          context.params.grantId,
          context.body.reason,
        ),
    )
    .post(
      '/grants/:grantId/review',
      {
        params: t.Object({ grantId: uuid }),
        body: reviewBody,
        response: { 201: breakGlassReviewSchema },
        detail: routeDetail('Review emergency access after the fact'),
      },
      async (context) => {
        const review = await reviewGrant(
          dependencies,
          context.breakGlassContext,
          context.params.grantId,
          context.body.decision,
          context.body.notes ?? null,
        )
        context.set.status = 201
        return review
      },
    )
}

async function resolveContext(
  dependencies: BreakGlassRouterDependencies,
  context: {
    headers: { authorization?: string }
    request: Request
    server: unknown
  },
): Promise<BreakGlassContext> {
  const authenticated = await authenticateBearer(
    context.headers.authorization,
    dependencies.sessions,
    dependencies.users,
  )
  const base = requestContext(
    context.request,
    context.server as RequestServer | null | undefined,
    requestIdOf(context),
  )
  return {
    actor: authenticated.user,
    sessionId: authenticated.session.id,
    aal: authenticated.session.aal,
    amr: authenticated.session.amr,
    authTime: authenticated.session.authTime,
    requestId: base.requestId,
    ip: base.ip,
    userAgentHash: base.userAgentHash,
  }
}
