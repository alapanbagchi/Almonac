import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import { createInvitationRepository } from '../../../repositories/invitation-repository'
import { pageRequest, pageResponse } from '../../../shared/pagination'
import { invitationResponse, type InvitationResponse } from './responses'

export interface ListInvitationsInput {
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly limit?: string
  readonly offset?: string
}

/** List invitations of an organisation, optionally narrowed to one hospital. */
export async function listInvitations(
  d: AdminDependencies,
  context: AdminRequestContext,
  input: ListInvitationsInput,
): Promise<{ items: InvitationResponse[]; nextOffset: number | null }> {
  await d.authorize(context.actor.id, 'membership.manage', {
    organisationId: input.organisationId,
    hospitalId: input.hospitalId,
  })

  const page = await createInvitationRepository(d.db).list(
    { organisationId: input.organisationId, hospitalId: input.hospitalId },
    pageRequest({ limit: input.limit, offset: input.offset }),
  )
  return pageResponse(page, invitationResponse)
}
