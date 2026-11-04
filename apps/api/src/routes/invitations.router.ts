import { Elysia, t } from 'elysia'
import type { InvitationDependencies } from '../controllers/admin/invitations/issue'
import { acceptInvitation } from '../controllers/admin/invitations/accept-invitation'
import { createInvitation } from '../controllers/admin/invitations/create-invitation'
import { listInvitations } from '../controllers/admin/invitations/list-invitations'
import { resendInvitation } from '../controllers/admin/invitations/resend-invitation'
import { revokeInvitation } from '../controllers/admin/invitations/revoke-invitation'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import { pageSchema, scopedPageQuery } from '../shared/pagination'
import { instant, nullable, okSchema, routeDetail, uuid } from '../shared/validation'

const invitationSchema = t.Object({
  id: uuid,
  email: t.String(),
  organisationId: uuid,
  hospitalId: nullable(uuid),
  kind: t.Union([t.Literal('new_user'), t.Literal('existing_user')]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('accepted'),
    t.Literal('revoked'),
    t.Literal('expired'),
  ]),
  zitadelSub: nullable(t.String()),
  expiresAt: instant,
  createdAt: instant,
  acceptedAt: nullable(instant),
  acceptedByUserId: nullable(uuid),
  invitedBy: uuid,
  roleIds: t.Array(uuid),
})

export const invitationBody = t.Object({
  email: t.String({ minLength: 3, maxLength: 320 }),
  displayName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  // The web form sends null for an organisation-wide invitation.
  hospitalId: t.Optional(nullable(uuid)),
  roleIds: t.Array(uuid, { minItems: 1, maxItems: 16 }),
})

const acceptBody = t.Object({ token: t.String({ minLength: 32, maxLength: 128 }) })
const invitationParams = t.Object({ invitationId: uuid })
const organisationParams = t.Object({ organisationId: uuid })

/** Invitations: list, invite, resend, revoke and accept. */
export function invitationsRouter(d: InvitationDependencies) {
  return new Elysia({ name: 'admin.invitations', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .get(
      '/organisations/:organisationId/invitations',
      {
        params: organisationParams,
        query: scopedPageQuery,
        response: { 200: pageSchema(invitationSchema) },
        detail: routeDetail('List invitations'),
      },
      async (context) =>
        listInvitations(d, adminContextOf(context), {
          organisationId: context.params.organisationId,
          hospitalId: context.query.hospitalId ?? null,
          limit: context.query.limit,
          offset: context.query.offset,
        }),
    )
    .post(
      '/organisations/:organisationId/invitations',
      {
        params: organisationParams,
        body: invitationBody,
        response: { 201: invitationSchema },
        detail: routeDetail('Invite a person'),
      },
      async (context) => {
        const { email, displayName, hospitalId, roleIds } = context.body
        const invitation = await createInvitation(d, adminContextOf(context), {
          email,
          ...(displayName === undefined ? {} : { displayName }),
          organisationId: context.params.organisationId,
          hospitalId: hospitalId ?? null,
          roleIds,
        })
        context.set.status = 201
        return invitation
      },
    )
    .post(
      '/invitations/:invitationId/resend',
      {
        params: invitationParams,
        response: { 200: invitationSchema },
        detail: routeDetail('Resend an invitation'),
      },
      async (context) => resendInvitation(d, adminContextOf(context), context.params.invitationId),
    )
    .post(
      '/invitations/:invitationId/revoke',
      {
        params: invitationParams,
        response: { 200: okSchema },
        detail: routeDetail('Revoke an invitation'),
      },
      async (context) => revokeInvitation(d, adminContextOf(context), context.params.invitationId),
    )
    .post(
      '/invitations/accept',
      {
        body: acceptBody,
        response: { 200: invitationSchema },
        detail: routeDetail('Accept an invitation'),
      },
      async (context) => acceptInvitation(d, adminContextOf(context), { token: context.body.token }),
    )
}
