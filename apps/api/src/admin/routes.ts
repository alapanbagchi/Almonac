import { Elysia, t } from 'elysia'
import type { AdminDependencies } from './admin-context'
import { adminContext } from './admin-context'
import { parseAuditCursor } from './audit-cursor'
import {
  acceptBody,
  auditSchema,
  domainBody,
  domainSchema,
  hospitalBody,
  hospitalSchema,
  invitationBody,
  invitationSchema,
  limitOf,
  listLimit,
  membershipSchema,
  organisationBody,
  organisationSchema,
  reasonBody,
  roleBody,
  routeDetail,
  uuid,
  verifyDomainBody,
} from './admin-model'
import {
  auditResponse,
  domainResponse,
  hospitalResponse,
  invitationResponse,
  membershipResponse,
  organisationResponse,
  roleResponse,
} from './admin-responses'
import { authenticateBearer } from '../auth/bearer'
import { pageRequest, pageSchema, paginationFields } from '../shared/pagination'
import { requestIdOf } from '../shared/request'

/**
 * Organisation, hospital, membership, invitation and audit administration.
 * Every handler resolves a bearer session and re-checks permission in the
 * service; the browser's session response is never an authorisation source.
 */
export function createAdmin(dependencies: AdminDependencies) {
  const contextOf = async (context: {
    headers: { authorization?: string }
    request: Request
    server: unknown
  }) => {
    const authenticated = await authenticateBearer(
      context.headers.authorization,
      dependencies.sessions,
      dependencies.users,
    )
    return adminContext(
      authenticated,
      context.request,
      context.server as { requestIP?: (request: Request) => { address?: string } | null } | null,
      requestIdOf(context),
    )
  }

  return new Elysia({ name: 'admin.routes', prefix: '/v1/admin', tags: ['Administration'] })
    .derive(async (context) => ({ adminContext: await contextOf(context) }))
    .post(
      '/organisations',
      {
        body: organisationBody,
        response: { 201: organisationSchema },
        detail: routeDetail('Create an organisation'),
      },
      async (context) => {
        const organisation = await dependencies.organisations.create(
          context.adminContext,
          context.body,
        )
        context.set.status = 201
        return organisationResponse(organisation)
      },
    )
    .get(
      '/organisations',
      {
        query: t.Object({ ...paginationFields }),
        response: { 200: pageSchema(organisationSchema) },
        detail: routeDetail('List organisations'),
      },
      async (context) => {
        const organisations = await dependencies.organisations.list(
          context.adminContext,
          pageRequest(context.query),
        )
        return {
          items: organisations.items.map(organisationResponse),
          nextOffset: organisations.nextOffset,
        }
      },
    )
    .get(
      '/organisations/:organisationId',
      {
        params: t.Object({ organisationId: uuid }),
        response: { 200: organisationSchema },
        detail: routeDetail('Read an organisation'),
      },
      async (context) => organisationResponse(
        await dependencies.organisations.get(context.adminContext, context.params.organisationId),
      ),
    )
    .get(
      '/organisations/:organisationId/hospitals',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({ ...paginationFields }),
        response: { 200: pageSchema(hospitalSchema) },
        detail: routeDetail('List hospitals'),
      },
      async (context) => {
        const hospitals = await dependencies.hospitals.list(
          context.adminContext,
          context.params.organisationId,
          pageRequest(context.query),
        )
        return {
          items: hospitals.items.map(hospitalResponse),
          nextOffset: hospitals.nextOffset,
        }
      },
    )
    .post(
      '/organisations/:organisationId/hospitals',
      {
        params: t.Object({ organisationId: uuid }),
        body: hospitalBody,
        response: { 201: hospitalSchema },
        detail: routeDetail('Create a hospital'),
      },
      async (context) => {
        const hospital = await dependencies.hospitals.create(
          context.adminContext,
          context.params.organisationId,
          {
            name: context.body.name,
            slug: context.body.slug,
            timezone: context.body.timezone ?? 'UTC',
          },
        )
        context.set.status = 201
        return hospitalResponse(hospital)
      },
    )
    .get(
      '/hospitals/:hospitalId/domains',
      {
        params: t.Object({ hospitalId: uuid }),
        query: t.Object({ ...paginationFields }),
        response: { 200: pageSchema(domainSchema) },
        detail: routeDetail('List hospital domains'),
      },
      async (context) => {
        const domains = await dependencies.hospitals.listDomains(
          context.adminContext,
          context.params.hospitalId,
          pageRequest(context.query),
        )
        return {
          items: domains.items.map(domainResponse),
          nextOffset: domains.nextOffset,
        }
      },
    )
    .post(
      '/hospitals/:hospitalId/domains',
      {
        params: t.Object({ hospitalId: uuid }),
        body: domainBody,
        response: {
          201: t.Object({ domain: domainSchema, token: t.String() }),
        },
        detail: routeDetail('Add a hospital domain'),
      },
      async (context) => {
        const created = await dependencies.hospitals.addDomain(
          context.adminContext,
          context.params.hospitalId,
          context.body.domain,
        )
        context.set.status = 201
        return { domain: domainResponse(created.domain), token: created.token }
      },
    )
    .post(
      '/hospitals/:hospitalId/domains/:domainId/verify',
      {
        params: t.Object({ hospitalId: uuid, domainId: uuid }),
        body: verifyDomainBody,
        response: { 200: domainSchema },
        detail: routeDetail('Verify a hospital domain'),
      },
      async (context) => domainResponse(
        await dependencies.hospitals.verifyDomain(
          context.adminContext,
          context.params.hospitalId,
          context.params.domainId,
          context.body.token,
        ),
      ),
    )
    .post(
      '/hospitals/:hospitalId/domains/:domainId/primary',
      {
        params: t.Object({ hospitalId: uuid, domainId: uuid }),
        response: { 200: hospitalSchema },
        detail: routeDetail('Set the primary hospital domain'),
      },
      async (context) => hospitalResponse(
        await dependencies.hospitals.setPrimaryDomain(
          context.adminContext,
          context.params.hospitalId,
          context.params.domainId,
        ),
      ),
    )
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
          context.adminContext,
          {
            organisationId: context.params.organisationId,
            hospitalId: context.query.hospitalId ?? null,
          },
          pageRequest(context.query),
        )
        return {
          items: memberships.items.map(membershipResponse),
          nextOffset: memberships.nextOffset,
        }
      },
    )
    .get(
      '/organisations/:organisationId/roles',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({ ...paginationFields }),
        response: {
          200: pageSchema(t.Object({
            id: t.String(),
            key: t.String(),
            name: t.String(),
            scope: t.String(),
            permissions: t.Array(t.String()),
          })),
        },
        detail: routeDetail('List assignable roles'),
      },
      async (context) => {
        const roles = await dependencies.memberships.listRoles(
          context.adminContext,
          context.params.organisationId,
          pageRequest(context.query),
        )
        return {
          items: roles.items.map(roleResponse),
          nextOffset: roles.nextOffset,
        }
      },
    )
    .post(
      '/memberships/:membershipId/suspend',
      {
        params: t.Object({ membershipId: uuid }),
        body: reasonBody,
        detail: routeDetail('Suspend a membership'),
      },
      async (context) => {
        await dependencies.memberships.suspend(
          context.adminContext,
          context.params.membershipId,
          context.body.reason,
        )
        return { ok: true }
      },
    )
    .post(
      '/memberships/:membershipId/revoke',
      {
        params: t.Object({ membershipId: uuid }),
        body: reasonBody,
        detail: routeDetail('Revoke a membership'),
      },
      async (context) => {
        await dependencies.memberships.revoke(
          context.adminContext,
          context.params.membershipId,
          context.body.reason,
        )
        return { ok: true }
      },
    )
    .post(
      '/memberships/:membershipId/roles',
      {
        params: t.Object({ membershipId: uuid }),
        body: roleBody,
        detail: routeDetail('Assign a role'),
      },
      async (context) => {
        await dependencies.memberships.assignRole(
          context.adminContext,
          context.params.membershipId,
          context.body.roleId,
        )
        return { ok: true }
      },
    )
    .delete(
      '/memberships/:membershipId/roles/:roleId',
      {
        params: t.Object({ membershipId: uuid, roleId: uuid }),
        detail: routeDetail('Remove a role'),
      },
      async (context) => {
        await dependencies.memberships.revokeRole(
          context.adminContext,
          context.params.membershipId,
          context.params.roleId,
        )
        return { ok: true }
      },
    )
    .get(
      '/organisations/:organisationId/invitations',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({ hospitalId: t.Optional(uuid), ...paginationFields }),
        response: { 200: pageSchema(invitationSchema) },
        detail: routeDetail('List invitations'),
      },
      async (context) => {
        const invitations = await dependencies.invitations.list(
          context.adminContext,
          {
            organisationId: context.params.organisationId,
            hospitalId: context.query.hospitalId ?? null,
          },
          pageRequest(context.query),
        )
        return {
          items: invitations.items.map(invitationResponse),
          nextOffset: invitations.nextOffset,
        }
      },
    )
    .post(
      '/organisations/:organisationId/invitations',
      {
        params: t.Object({ organisationId: uuid }),
        body: invitationBody,
        response: { 201: invitationSchema },
        detail: routeDetail('Invite a person'),
      },
      async (context) => {
        const requestContext = context.adminContext
        const invitation = await dependencies.invitations.create(requestContext, {
          email: context.body.email,
          ...(context.body.displayName === undefined ? {} : { displayName: context.body.displayName }),
          organisationId: context.params.organisationId,
          hospitalId: context.body.hospitalId ?? null,
          roleIds: context.body.roleIds,
        })
        context.set.status = 201
        return invitationResponse(invitation)
      },
    )
    .post(
      '/invitations/:invitationId/resend',
      {
        params: t.Object({ invitationId: uuid }),
        response: { 200: invitationSchema },
        detail: routeDetail('Resend an invitation'),
      },
      async (context) => invitationResponse(
        await dependencies.invitations.resend(
          context.adminContext,
          context.params.invitationId,
        ),
      ),
    )
    .delete(
      '/invitations/:invitationId',
      {
        params: t.Object({ invitationId: uuid }),
        detail: routeDetail('Revoke an invitation'),
      },
      async (context) => {
        await dependencies.invitations.revoke(
          context.adminContext,
          context.params.invitationId,
        )
        return { ok: true }
      },
    )
    .post(
      '/invitations/accept',
      {
        body: acceptBody,
        response: { 200: invitationSchema },
        detail: routeDetail('Accept an invitation'),
      },
      async (context) => invitationResponse(
        await dependencies.invitations.accept(
          context.adminContext,
          context.body.token,
        ),
      ),
    )
    .get(
      '/organisations/:organisationId/audit',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({
          hospitalId: t.Optional(uuid),
          limit: listLimit,
          cursor: t.Optional(t.String({ maxLength: 60 })),
        }),
        response: {
          200: t.Object({ entries: t.Array(auditSchema), nextCursor: t.Union([t.String(), t.Null()]) }),
        },
        detail: routeDetail('Read the audit log'),
      },
      async (context) => {
        const entries = await dependencies.audit.list(context.adminContext, {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
          limit: limitOf(context.query.limit),
          cursor: parseAuditCursor(context.query.cursor),
        })
        const last = entries.at(-1)
        return {
          entries: entries.map(auditResponse),
          nextCursor: last?.cursor ?? null,
        }
      },
    )
}
