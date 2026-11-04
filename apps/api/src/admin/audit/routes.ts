import { Elysia, t } from 'elysia'
import { adminContextOf, type AdminDependencies } from '../admin-context'
import { auditSchema, routeDetail, uuid } from '../admin-model'
import { listAudit } from './controllers/list-audit'
import { auditQuery } from './validators/audit-query'

/** The catalogued audit log: one organisation, optionally one hospital. */
export function auditRoutes(dependencies: AdminDependencies) {
  return new Elysia().get(
    '/organisations/:organisationId/audit',
    {
      params: t.Object({ organisationId: uuid }),
      query: auditQuery,
      response: {
        200: t.Object({ entries: t.Array(auditSchema), nextCursor: t.Union([t.String(), t.Null()]) }),
      },
      detail: routeDetail('Read the audit log'),
    },
    (context) => {
      const { actor } = adminContextOf(context)
      return listAudit(dependencies.audit, actor.id, context.params.organisationId, context.query)
    },
  )
}
