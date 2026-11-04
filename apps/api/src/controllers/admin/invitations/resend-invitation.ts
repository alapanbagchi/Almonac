import type { AdminRequestContext } from '../../../guards/admin-context'
import { conflict } from '../../../shared/errors'
import {
  draftOf,
  invitationScope,
  issue,
  now,
  requireInvitation,
  resendInitialisation,
  type InvitationDependencies,
} from './issue'
import { invitationResponse, type InvitationResponse } from './responses'

/**
 * Reissue a pending invitation: the old link is revoked in the same transaction
 * that writes the new one, so exactly one token stays live.
 */
export async function resendInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  invitationId: string,
): Promise<InvitationResponse> {
  const invitation = await requireInvitation(d, context, invitationId)
  if (invitation.status !== 'pending' || invitation.expiresAt <= now()) {
    throw conflict('Invitation is no longer pending.')
  }

  const scope = await invitationScope(d.pool, invitation.organisationId, invitation.hospitalId)
  await resendInitialisation(d, scope.organisation, invitation)
  const reissued = await issue(d, context, draftOf(invitation), scope.delivery, {
    reasonCode: 'invitation.resend',
    replaces: invitation,
  })
  return invitationResponse(reissued)
}
