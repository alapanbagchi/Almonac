import type { AdminRequestContext } from '../../../guards/admin-context'
import {
  requireInvitation,
  revokePendingInvitation,
  type InvitationDependencies,
} from './issue'

/** Revoke a pending invitation. The audit row joins the revocation's transaction. */
export async function revokeInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  invitationId: string,
): Promise<{ ok: true }> {
  const invitation = await requireInvitation(d, context, invitationId)
  await d.transaction(async (db) => {
    await revokePendingInvitation(d, context, db, invitation)
  })
  return { ok: true }
}
