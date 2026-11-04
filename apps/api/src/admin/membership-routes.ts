import { Elysia, t } from 'elysia'
import { adminContextOf, routeGroup, type AdminDependencies } from './admin-context'
import { membershipSchema, okSchema, reasonBody, roleBody, roleSchema, routeDetail, uuid } from './admin-model'
import { membershipResponse, roleResponse } from './admin-responses'
import { pageRequest, pageResponse, pageSchema, paginationFields } from '../shared/pagination'

/** Memberships: list, suspend, revoke, and role assignment. */
export function membershipRoutes(dependencies: AdminDependencies) {
  return routeGroup(
    new Elysia()
      .get(
        '/organisations/:organisationId/memberships',
        {
          params: t.Object({ organisationId: uuid }),
          query: t.Object({ hospitalId: t.Optional(uuid), ...paginationFields }),
          response: { 200: pageSchema(membershipSchema) },
          detail: routeDetail('List memberships'),
        },
        async (context) => {
          const memberships = await dependencies.memberships.list(
            adminContextOf(context),
            {
              organisationId: context.params.organisationId,
              hospitalId: context.query.hospitalId ?? null,
            },
            pageRequest(context.query),
          )
          return pageResponse(memberships, membershipResponse)
        },
      )
      .get(
        '/organisations/:organisationId/roles',
        {
          params: t.Object({ organisationId: uuid }),
          query: t.Object({ ...paginationFields }),
          response: { 200: pageSchema(roleSchema) },
          detail: routeDetail('List assignable roles'),
        },
        async (context) => {
          const roles = await dependencies.memberships.listRoles(
            adminContextOf(context),
            context.params.organisationId,
            pageRequest(context.query),
          )
          return pageResponse(roles, roleResponse)
        },
      )
      .post(
        '/memberships/:membershipId/suspend',
        {
          params: t.Object({ membershipId: uuid }),
          body: reasonBody,
          response: { 200: okSchema },
          detail: routeDetail('Suspend a membership'),
        },
        async (context) => {
          const { reason } = context.body
          await dependencies.memberships.suspend(
            adminContextOf(context),
            context.params.membershipId,
            reason,
          )
          return { ok: true }
        },
      )
      .post(
        '/memberships/:membershipId/revoke',
        {
          params: t.Object({ membershipId: uuid }),
          body: reasonBody,
          response: { 200: okSchema },
          detail: routeDetail('Revoke a membership'),
        },
        async (context) => {
          const { reason } = context.body
          await dependencies.memberships.revoke(
            adminContextOf(context),
            context.params.membershipId,
            reason,
          )
          return { ok: true }
        },
      )
      .post(
        '/memberships/:membershipId/roles',
        {
          params: t.Object({ membershipId: uuid }),
          body: roleBody,
          response: { 200: okSchema },
          detail: routeDetail('Assign a role'),
        },
        async (context) => {
          const { roleId } = context.body
          await dependencies.memberships.assignRole(
            adminContextOf(context),
            context.params.membershipId,
            roleId,
          )
          return { ok: true }
        },
      )
      .delete(
        '/memberships/:membershipId/roles/:roleId',
        {
          params: t.Object({ membershipId: uuid, roleId: uuid }),
          response: { 200: okSchema },
          detail: routeDetail('Remove a role'),
        },
        async (context) => {
          await dependencies.memberships.revokeRole(
            adminContextOf(context),
            context.params.membershipId,
            context.params.roleId,
          )
          return { ok: true }
        },
      ),
  )
}