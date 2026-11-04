import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { assignRole } from '../controllers/admin/memberships/assign-role'
import { listMemberships } from '../controllers/admin/memberships/list-memberships'
import { revokeMembership } from '../controllers/admin/memberships/revoke-membership'
import { revokeRole } from '../controllers/admin/memberships/revoke-role'
import { suspendMembership } from '../controllers/admin/memberships/suspend-membership'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import { pageRequest, pageSchema, pageValues, scopedPageQuery } from '../shared/pagination'
import { instant, nullable, okSchema, reasonBody, roleBody, routeDetail, uuid } from '../shared/validation'

const membershipParams = t.Object({ membershipId: uuid })

const membershipSchema = t.Object({
  id: uuid,
  userId: uuid,
  email: t.String(),
  displayName: t.String(),
  organisationId: uuid,
  hospitalId: nullable(t.String()),
  status: t.Union([
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  acceptedAt: instant,
  endsAt: nullable(instant),
  roles: t.Array(t.String()),
})

export function membershipsRouter(d: AdminDependencies) {
  return new Elysia({ name: 'admin.memberships', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .get(
      '/organisations/:organisationId/memberships',
      {
        params: t.Object({ organisationId: uuid }),
        query: scopedPageQuery,
        response: { 200: pageSchema(membershipSchema) },
        detail: routeDetail('List memberships'),
      },
      async (context) => {
        const hospitalId = context.query.hospitalId ?? null
        return listMemberships(
          d,
          adminContextOf(context),
          context.params.organisationId,
          hospitalId,
          pageRequest(pageValues(context)),
        )
      },
    )
    .post(
      '/memberships/:membershipId/suspend',
      {
        params: membershipParams,
        body: reasonBody,
        response: { 200: okSchema },
        detail: routeDetail('Suspend a membership'),
      },
      async (context) =>
        suspendMembership(
          d,
          adminContextOf(context),
          context.params.membershipId,
          context.body.reason,
        ),
    )
    .post(
      '/memberships/:membershipId/revoke',
      {
        params: membershipParams,
        body: reasonBody,
        response: { 200: okSchema },
        detail: routeDetail('Revoke a membership'),
      },
      async (context) =>
        revokeMembership(
          d,
          adminContextOf(context),
          context.params.membershipId,
          context.body.reason,
        ),
    )
    .post(
      '/memberships/:membershipId/roles',
      {
        params: membershipParams,
        body: roleBody,
        response: { 200: okSchema },
        detail: routeDetail('Assign a role'),
      },
      async (context) =>
        assignRole(
          d,
          adminContextOf(context),
          context.params.membershipId,
          context.body.roleId,
        ),
    )
    .delete(
      '/memberships/:membershipId/roles/:roleId',
      {
        params: t.Object({ membershipId: uuid, roleId: uuid }),
        response: { 200: okSchema },
        detail: routeDetail('Remove a role'),
      },
      async (context) =>
        revokeRole(
          d,
          adminContextOf(context),
          context.params.membershipId,
          context.params.roleId,
        ),
    )
}
