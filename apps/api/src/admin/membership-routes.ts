import { Elysia, t } from 'elysia'
import { adminContextOf, type AdminDependencies } from './admin-context'
import { membershipSchema, okSchema, reasonBody, roleBody, roleSchema, routeDetail, uuid } from './admin-model'
import { membershipResponse, roleResponse } from './admin-responses'
import { pageQuery, pageRequest, pageResponse, pageSchema, pageValues, scopedPageQuery } from '../shared/pagination'

/** Memberships: list, suspend, revoke, and role assignment. */
export function membershipRoutes(dependencies: AdminDependencies) {
  const { memberships: service } = dependencies
  const membershipParams = t.Object({ membershipId: uuid })

  /** Every membership mutation answers the same way. */
  const done = async (change: Promise<unknown>) => {
    await change
    return { ok: true as const }
  }

  return new Elysia()
    .get(
      '/organisations/:organisationId/memberships',
      {
        params: t.Object({ organisationId: uuid }),
        query: scopedPageQuery,
        response: { 200: pageSchema(membershipSchema) },
        detail: routeDetail('List memberships'),
      },
      async (context) =>
        pageResponse(
          await service.list(
            adminContextOf(context),
            {
              organisationId: context.params.organisationId,
              hospitalId: context.query.hospitalId ?? null,
            },
            pageRequest(pageValues(context)),
          ),
          membershipResponse,
        ),
    )
    .get(
      '/organisations/:organisationId/roles',
      {
        params: t.Object({ organisationId: uuid }),
        query: pageQuery,
        response: { 200: pageSchema(roleSchema) },
        detail: routeDetail('List assignable roles'),
      },
      async (context) =>
        pageResponse(
          await service.listRoles(
            adminContextOf(context),
            context.params.organisationId,
            pageRequest(pageValues(context)),
          ),
          roleResponse,
        ),
    )
    .post(
      '/memberships/:membershipId/suspend',
      { params: membershipParams, body: reasonBody, response: { 200: okSchema }, detail: routeDetail('Suspend a membership') },
      async (context) =>
        done(service.suspend(adminContextOf(context), context.params.membershipId, context.body.reason)),
    )
    .post(
      '/memberships/:membershipId/revoke',
      { params: membershipParams, body: reasonBody, response: { 200: okSchema }, detail: routeDetail('Revoke a membership') },
      async (context) =>
        done(service.revoke(adminContextOf(context), context.params.membershipId, context.body.reason)),
    )
    .post(
      '/memberships/:membershipId/roles',
      { params: membershipParams, body: roleBody, response: { 200: okSchema }, detail: routeDetail('Assign a role') },
      async (context) =>
        done(service.assignRole(adminContextOf(context), context.params.membershipId, context.body.roleId)),
    )
    .delete(
      '/memberships/:membershipId/roles/:roleId',
      {
        params: t.Object({ membershipId: uuid, roleId: uuid }),
        response: { 200: okSchema },
        detail: routeDetail('Remove a role'),
      },
      async (context) =>
        done(
          service.revokeRole(adminContextOf(context), context.params.membershipId, context.params.roleId),
        ),
    )
}
