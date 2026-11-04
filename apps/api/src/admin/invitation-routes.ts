import { Elysia, t } from 'elysia'
import { adminContextOf, type AdminDependencies } from './admin-context'
import { acceptBody, invitationBody, invitationSchema, okSchema, routeDetail, uuid } from './admin-model'
import { invitationResponse } from './admin-responses'
import { pageRequest, pageResponse, pageSchema, pageValues, scopedPageQuery } from '../shared/pagination'

/** Invitations: invite, list, resend, revoke, accept. */
export function invitationRoutes(dependencies: AdminDependencies) {
  const { invitations } = dependencies
  const invitationParams = t.Object({ invitationId: uuid })

  return new Elysia()
    .get(
      '/organisations/:organisationId/invitations',
      {
        params: t.Object({ organisationId: uuid }),
        query: scopedPageQuery,
        response: { 200: pageSchema(invitationSchema) },
        detail: routeDetail('List invitations'),
      },
      async (context) =>
        pageResponse(
          await invitations.list(
            adminContextOf(context),
            {
              organisationId: context.params.organisationId,
              hospitalId: context.query.hospitalId ?? null,
            },
            pageRequest(pageValues(context)),
          ),
          invitationResponse,
        ),
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
        const invitation = await invitations.create(adminContextOf(context), {
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
      { params: invitationParams, response: { 200: invitationSchema }, detail: routeDetail('Resend an invitation') },
      async (context) =>
        invitationResponse(
          await invitations.resend(adminContextOf(context), context.params.invitationId),
        ),
    )
    .delete(
      '/invitations/:invitationId',
      { params: invitationParams, response: { 200: okSchema }, detail: routeDetail('Revoke an invitation') },
      async (context) => {
        await invitations.revoke(adminContextOf(context), context.params.invitationId)
        return { ok: true as const }
      },
    )
    .post(
      '/invitations/accept',
      { body: acceptBody, response: { 200: invitationSchema }, detail: routeDetail('Accept an invitation') },
      async (context) =>
        invitationResponse(await invitations.accept(adminContextOf(context), context.body.token)),
    )
}
