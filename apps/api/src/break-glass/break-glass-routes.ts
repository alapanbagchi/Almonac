import { Elysia, t } from 'elysia'
import type { AppUser } from '../identity/app-user-repository'
import type { WebSession } from '../identity/session-repository'
import { authenticateBearer, type SessionAuthenticator, type UserLookup } from '../auth/bearer'
import { requestContext, type RequestServer } from '../auth/request-context'
import { pageRequest, pageSchema } from '../shared/pagination'
import { requestIdOf } from '../shared/request'
import type { BreakGlassGrant, BreakGlassReview } from './break-glass-repository'
import type { BreakGlassContext, BreakGlassService } from './break-glass-service'
import {
  breakGlassGrantBody,
  breakGlassGrantSchema,
  breakGlassReviewSchema,
  grantListQuery,
  revokeBody,
  reviewBody,
  routeDetail,
  uuid,
} from './break-glass-model'

export interface BreakGlassDependencies {
  readonly grants: BreakGlassService
  readonly sessions: SessionAuthenticator
  readonly users: UserLookup
}

/**
 * Time-boxed emergency access. Every route authenticates a bearer session and
 * the service re-checks permission, membership and assurance. The response is
 * never a substitute for authorisation on a clinical route.
 */
export function createBreakGlass(dependencies: BreakGlassDependencies) {
  const contextOf = async (context: {
    headers: { authorization?: string }
    request: Request
    server: unknown
  }): Promise<BreakGlassContext> => {
    const authenticated = await authenticateBearer(
      context.headers.authorization,
      dependencies.sessions,
      dependencies.users,
    )
    return breakGlassContext(
      authenticated.user,
      authenticated.session,
      context.request,
      context.server as RequestServer | null | undefined,
      requestIdOf(context),
    )
  }

  return new Elysia({ name: 'break-glass.routes', prefix: '/v1/break-glass', tags: ['Break glass'] })
    .derive(async (context) => ({ breakGlassContext: await contextOf(context) }))
    .post(
      '/grants',
      {
        body: breakGlassGrantBody,
        response: { 201: breakGlassGrantSchema },
        detail: routeDetail('Request emergency access'),
      },
      async (context) => {
        const actor = context.breakGlassContext
        const grant =
          context.body.mode === 'pre_approved'
            ? await dependencies.grants.createPreApproved(actor, {
                hospitalId: context.body.hospitalId,
                reason: context.body.reason,
                durationMinutes: context.body.durationMinutes,
                userId: context.body.userId,
              })
            : await dependencies.grants.requestEmergency(actor, {
                hospitalId: context.body.hospitalId,
                reason: context.body.reason,
                durationMinutes: context.body.durationMinutes,
              })
        context.set.status = 201
        return grantResponse(grant)
      },
    )
    .get(
      '/grants',
      {
        query: grantListQuery,
        response: { 200: pageSchema(breakGlassGrantSchema) },
        detail: routeDetail('List emergency access grants'),
      },
      async (context) => {
        const grants = await dependencies.grants.list(
          context.breakGlassContext,
          context.query.hospitalId ?? null,
          pageRequest(context.query),
        )
        return { items: grants.items.map(grantResponse), nextOffset: grants.nextOffset }
      },
    )
    .post(
      '/grants/:grantId/activate',
      {
        params: t.Object({ grantId: uuid }),
        response: { 200: breakGlassGrantSchema },
        detail: routeDetail('Activate an approved grant'),
      },
      async (context) =>
        grantResponse(
          await dependencies.grants.activate(context.breakGlassContext, context.params.grantId),
        ),
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
        grantResponse(
          await dependencies.grants.revoke(
            context.breakGlassContext,
            context.params.grantId,
            context.body.reason,
          ),
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
        const review = await dependencies.grants.review(
          context.breakGlassContext,
          context.params.grantId,
          context.body.decision,
          context.body.notes ?? null,
        )
        context.set.status = 201
        return reviewResponse(review)
      },
    )
}

function breakGlassContext(
  actor: AppUser,
  session: WebSession,
  request: Request,
  server: RequestServer | null | undefined,
  requestId: string,
): BreakGlassContext {
  const base = requestContext(request, server, requestId)
  return {
    actor,
    sessionId: session.id,
    aal: session.aal,
    amr: session.amr,
    authTime: session.authTime,
    requestId,
    ip: base.ip,
    userAgentHash: base.userAgentHash,
  }
}

function grantResponse(grant: BreakGlassGrant) {
  return {
    id: grant.id,
    organisationId: grant.organisationId,
    hospitalId: grant.hospitalId,
    userId: grant.userId,
    approvedBy: grant.approvedBy,
    approvalMode: grant.approvalMode,
    reason: grant.reason,
    accessLevel: grant.accessLevel,
    status: grant.status,
    startsAt: grant.startsAt.toISOString(),
    endsAt: grant.endsAt.toISOString(),
    approvedAt: grant.approvedAt.toISOString(),
    activatedAt: grant.activatedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    expiredAt: grant.expiredAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
  }
}

function reviewResponse(review: BreakGlassReview) {
  return {
    id: review.id,
    grantId: review.grantId,
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt.toISOString(),
    decision: review.decision,
    notes: review.notes,
  }
}
