import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { listAudit } from '../controllers/admin/audit/list-audit'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import { pageLimit } from '../shared/pagination'
import { instant, nullable, routeDetail, uuid } from '../shared/validation'

const auditEntrySchema = t.Object({
  id: t.String(),
  occurredAt: instant,
  actorType: t.Union([
    t.Literal('user'),
    t.Literal('system'),
    t.Literal('service'),
    t.Literal('break_glass'),
  ]),
  actorUserId: nullable(uuid),
  sessionId: nullable(t.String()),
  organisationId: nullable(uuid),
  hospitalId: nullable(uuid),
  eventType: t.String(),
  outcome: t.Union([t.Literal('success'), t.Literal('failure'), t.Literal('denied')]),
  targetType: nullable(t.String()),
  targetId: nullable(t.String()),
  requestId: nullable(t.String()),
  reasonCode: nullable(t.String()),
  metadata: t.Record(
    t.String(),
    t.Union([t.String(), t.Number(), t.Boolean(), t.Null()]),
  ),
})

const auditQuery = t.Object({
  hospitalId: t.Optional(uuid),
  limit: pageLimit,
  cursor: t.Optional(t.String({ maxLength: 60 })),
})

const auditPageSchema = t.Object({
  entries: t.Array(auditEntrySchema),
  nextCursor: t.Union([t.String(), t.Null()]),
})

/** The organisation audit read: newest first, paged by cursor. */
export function auditRouter(d: AdminDependencies) {
  return new Elysia({ name: 'admin.audit', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .get(
      '/organisations/:organisationId/audit',
      {
        params: t.Object({ organisationId: uuid }),
        query: auditQuery,
        response: { 200: auditPageSchema },
        detail: routeDetail('Read the organisation audit log'),
      },
      async (context) =>
        listAudit(d, adminContextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
          limit: context.query.limit,
          cursor: context.query.cursor,
        }),
    )
}
