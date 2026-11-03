import { Elysia, t } from 'elysia'
import type { AdminDependencies } from './admin-context'
import { adminContext } from './admin-context'
import {
  acceptBody,
  auditId,
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
import { requestIdOf } from '../auth/request-context'



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
    .onRequest(({ set }) => {
      set.headers['cache-control'] = 'no-store'
    })
    .post(
      '/organisations',
      {
        body: organisationBody,
        response: { 201: organisationSchema },
        detail: routeDetail('Create an organisation'),
      },
      async (context) => {
        const organisation = await dependencies.organisations.create(
          await contextOf(context),
          context.body,
        )
        context.set.status = 201
        return organisationResponse(organisation)
      },
    )
    .get(
      '/organisations',
      {
        response: { 200: t.Array(organisationSchema) },
        detail: routeDetail('List organisations'),
      },
      async (context) => {
        const organisations = await dependencies.organisations.list(await contextOf(context))
        return organisations.map(organisationResponse)
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
        await dependencies.organisations.get(await contextOf(context), context.params.organisationId),
      ),
    )
    .get(
      '/organisations/:organisationId/hospitals',
      {
        params: t.Object({ organisationId: uuid }),
        response: { 200: t.Array(hospitalSchema) },
        detail: routeDetail('List hospitals'),
      },
      async (context) => {
        const hospitals = await dependencies.hospitals.list(
          await contextOf(context),
          context.params.organisationId,
        )
        return hospitals.map(hospitalResponse)
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
          await contextOf(context),
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
        response: { 200: t.Array(domainSchema) },
        detail: routeDetail('List hospital domains'),
      },
      async (context) => {
        const domains = await dependencies.hospitals.listDomains(
          await contextOf(context),
          context.params.hospitalId,
        )
        return domains.map(domainResponse)
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
          await contextOf(context),
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
          await contextOf(context),
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
          await contextOf(context),
          context.params.hospitalId,
          context.params.domainId,
        ),
      ),
    )
    .get(
      '/organisations/:organisationId/memberships',
      {
        params: t.Object({ organisationId: uuid }),
        query: t.Object({ hospitalId: t.Optional(uuid) }),
        response: { 200: t.Array(membershipSchema) },
        detail: routeDetail('List memberships'),
      },
      async (context) => {
        const memberships = await dependencies.memberships.list(await contextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
        })
        return memberships.map(membershipResponse)
      },
    )
    .get(
      '/organisations/:organisationId/roles',
      {
        params: t.Object({ organisationId: uuid }),
        response: {
          200: t.Array(t.Object({
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
          await contextOf(context),
          context.params.organisationId,
        )
        return roles.map(roleResponse)
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
          await contextOf(context),
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
          await contextOf(context),
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
          await contextOf(context),
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
          await contextOf(context),
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
        query: t.Object({ hospitalId: t.Optional(uuid) }),
        response: { 200: t.Array(invitationSchema) },
        detail: routeDetail('List invitations'),
      },
      async (context) => {
        const invitations = await dependencies.invitations.list(await contextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
        })
        return invitations.map(invitationResponse)
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
        const requestContext = await contextOf(context)
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
          await contextOf(context),
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
          await contextOf(context),
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
          await contextOf(context),
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
          before: t.Optional(t.String({ maxLength: 40 })),
          beforeId: t.Optional(auditId),
        }),
        response: {
          200: t.Object({ entries: t.Array(auditSchema), nextCursor: t.Union([t.String(), t.Null()]) }),
        },
        detail: routeDetail('Read the audit log'),
      },
      async (context) => {
        const entries = await dependencies.audit.list(await contextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
          limit: limitOf(context.query.limit),
          cursor:
            context.query.before !== undefined && context.query.beforeId !== undefined
              ? { occurredAt: new Date(context.query.before), id: context.query.beforeId }
              : null,
        })
        const last = entries.at(-1)
        return {
          entries: entries.map(auditResponse),
          nextCursor: last === undefined ? null : `${last.occurredAt.toISOString()}:${last.id}`,
        }
      },
    )
}
