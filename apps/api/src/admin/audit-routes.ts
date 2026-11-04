import { Elysia, t } from 'elysia'
import { adminContextOf, routeGroup, type AdminDependencies } from './admin-context'
import { auditSchema, routeDetail, uuid } from './admin-model'
import { auditResponse } from './admin-responses'
import { parseAuditCursor } from './audit-cursor'
import { auditLimit, paginationFields } from '../shared/pagination'

/** The catalogued audit log: one organisation, optionally one hospital. */
export function auditRoutes(dependencies: AdminDependencies) {
  return routeGroup(
    new Elysia().get(
      '/organisations/:organisationId/audit',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({
          hospitalId: t.Optional(uuid),
          limit: paginationFields.limit,
          cursor: t.Optional(t.String({ maxLength: 60 })),
        }),
        response: {
          200: t.Object({ entries: t.Array(auditSchema), nextCursor: t.Union([t.String(), t.Null()]) }),
        },
        detail: routeDetail('Read the audit log'),
      },
      async (context) => {
        const entries = await dependencies.audit.list(adminContextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
          limit: auditLimit(context.query.limit),
          cursor: parseAuditCursor(context.query.cursor),
        })
        return {
          entries: entries.map(auditResponse),
          nextCursor: entries.at(-1)?.cursor ?? null,
        }
      },
    ),
  )
}