import type {
  Invitation,
  InvitationKind,
  InvitationStatus,
} from '../../../repositories/invitation-repository'
import { instant, maybeInstant } from '../../../shared/instant'

/** An invitation as the API publishes it: instants are strings, arrays are mutable. */
export interface InvitationResponse {
  readonly id: string
  readonly email: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly kind: InvitationKind
  readonly status: InvitationStatus
  readonly zitadelSub: string | null
  readonly expiresAt: string
  readonly createdAt: string
  readonly acceptedAt: string | null
  readonly acceptedByUserId: string | null
  readonly invitedBy: string
  readonly roleIds: string[]
}

/**
 * Map explicitly rather than spreading the row: a column rename must not
 * silently change the response, and a Date must never reach JSON as itself.
 */
export function invitationResponse(invitation: Invitation): InvitationResponse {
  return {
    id: invitation.id,
    email: invitation.email,
    organisationId: invitation.organisationId,
    hospitalId: invitation.hospitalId,
    kind: invitation.kind,
    status: invitation.status,
    zitadelSub: invitation.zitadelSub,
    expiresAt: instant(invitation.expiresAt),
    createdAt: instant(invitation.createdAt),
    acceptedAt: maybeInstant(invitation.acceptedAt),
    acceptedByUserId: invitation.acceptedByUserId,
    invitedBy: invitation.invitedBy,
    roleIds: [...invitation.roleIds],
  }
}
