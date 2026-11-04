import { Elysia, t } from 'elysia'
import { adminContextOf, routeGroup, type AdminDependencies } from './admin-context'
import { acceptBody, invitationBody, invitationSchema, okSchema, routeDetail, uuid } from './admin-model'
import { invitationResponse } from './admin-responses'
import { pageRequest, pageResponse, pageSchema, paginationFields } from '../shared/pagination'

/** Invitations: invite, list, resend, revoke, accept. */
export function invitationRoutes(dependencies: AdminDependencies) {
  return routeGroup(
    new Elysia()
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
            adminContextOf(context),
            {
              organisationId: context.params.organisationId,
              hospitalId: context.query.hospitalId ?? null,
            },
            pageRequest(context.query),
          )
          return pageResponse(invitations, invitationResponse)
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
          const { email, displayName, hospitalId, roleIds } = context.body
          const invitation = await dependencies.invitations.create(adminContextOf(context), {
            email,
            ...(displayName === undefined ? {} : { displayName }),
            organisationId: context.params.organisationId,
            hospitalId: hospitalId ?? null,
            roleIds,
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
          await dependencies.invitations.resend(adminContextOf(context), context.params.invitationId),
        ),
      )
      .delete(
        '/invitations/:invitationId',
        {
          params: t.Object({ invitationId: uuid }),
          response: { 200: okSchema },
          detail: routeDetail('Revoke an invitation'),
        },
        async (context) => {
          await dependencies.invitations.revoke(adminContextOf(context), context.params.invitationId)
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
        async (context) => {
          const { token } = context.body
          return invitationResponse(
            await dependencies.invitations.accept(adminContextOf(context), token),
          )
        },
      ),
  )
}