import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { listRoles } from '../controllers/admin/memberships/list-roles'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import { pageQuery, pageRequest, pageSchema, pageValues } from '../shared/pagination'
import { routeDetail, uuid } from '../shared/validation'

const roleSchema = t.Object({
  id: uuid,
  key: t.String(),
  name: t.String(),
  scope: t.Union([t.Literal('organisation'), t.Literal('hospital')]),
  permissions: t.Array(t.String()),
})

export function rolesRouter(d: AdminDependencies) {
  return new Elysia({ name: 'admin.roles', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .get(
      '/organisations/:organisationId/roles',
      {
        params: t.Object({ organisationId: uuid }),
        query: pageQuery,
        response: { 200: pageSchema(roleSchema) },
        detail: routeDetail('List assignable roles'),
      },
      async (context) =>
        listRoles(
          d,
          adminContextOf(context),
          context.params.organisationId,
          pageRequest(pageValues(context)),
        ),
    )
}
