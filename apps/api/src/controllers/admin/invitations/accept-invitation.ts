import type { AdminRequestContext } from '../../../guards/admin-context'
import { MembershipAdminRepository } from '../../../admin/membership-admin-repository'
import { withTransaction } from '../../../db/pool'
import {
  createInvitationRepository,
  type Invitation,
} from '../../../repositories/invitation-repository'
import { conflict, notFound } from '../../../shared/errors'
import { hashToken } from '../../../shared/tokens'
import {
  assertInvitationAcceptable,
  now,
  requireNoMembership,
  type InvitationDependencies,
} from './issue'
import { invitationResponse, type InvitationResponse } from './responses'

/**
 * Accept an invitation as the signed-in user. The invitation row is locked for
 * the transaction, the membership is created, and the row is marked accepted in
 * the same commit, so two simultaneous accepts cannot both win.
 */
export async function acceptInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  input: { token: string },
): Promise<InvitationResponse> {
  const actor = context.actor
  const accepted = await withTransaction(d.pool, async (db): Promise<Invitation> => {
    const invitations = createInvitationRepository(db)
    const invitation = await invitations.findByTokenHashForUpdate(hashToken(input.token))
    if (invitation === null) throw notFound('Invitation not found.')

    const at = now()
    assertInvitationAcceptable(invitation, actor, at)
    await requireNoMembership(db, actor.id, invitation)

    await new MembershipAdminRepository(db).createFromInvitation(
      {
        userId: actor.id,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
        roleIds: invitation.roleIds,
        assignedBy: invitation.invitedBy,
      },
      db,
    )

    const marked = await invitations.markAccepted(invitation.id, {
      acceptedByUserId: actor.id,
      at,
    })
    if (!marked) throw conflict('Invitation is no longer pending.')

    await d.audit.write(
      {
        actorUserId: actor.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
        eventType: 'invitation.accept',
        outcome: 'success',
        targetType: 'invitation',
        targetId: invitation.id,
        requestId: context.requestId,
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { invitation_id: invitation.id },
      },
      db,
    )

    return { ...invitation, status: 'accepted', acceptedAt: at, acceptedByUserId: actor.id }
  })
  return invitationResponse(accepted)
}
