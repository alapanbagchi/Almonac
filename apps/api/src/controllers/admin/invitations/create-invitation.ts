import type { AdminRequestContext } from '../../../guards/admin-context'
import { createAppUserRepository } from '../../../repositories/app-user-repository'
import { createInvitationRepository } from '../../../repositories/invitation-repository'
import { conflict, ruleViolation } from '../../../shared/errors'
import { normaliseEmail } from '../../../shared/email'
import {
  issue,
  prepareInvitation,
  requireNoMembership,
  resendInitialisation,
  type InvitationDependencies,
} from './issue'
import { invitationResponse, type InvitationResponse } from './responses'

export interface CreateInvitationInput {
  readonly email: string
  readonly displayName?: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly roleIds: readonly string[]
}

/**
 * Invite one person to an organisation or hospital. A pending invitation is
 * reissued rather than duplicated, an existing identity is invited directly,
 * and everyone else gets an identity provider account first.
 */
export async function createInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  input: CreateInvitationInput,
): Promise<InvitationResponse> {
  const email = normaliseEmail(input.email)
  if (email === null) throw ruleViolation('Email address is not valid.')

  const { scope, roleIds } = await prepareInvitation(d, context, {
    organisationId: input.organisationId,
    hospitalId: input.hospitalId,
    roleIds: input.roleIds,
  })
  const organisationId = scope.target.organisationId
  const hospitalId = scope.target.hospitalId ?? null

  const pending = await createInvitationRepository(d.db).findPendingForScope({
    email,
    organisationId,
    hospitalId,
  })
  if (pending !== null) {
    await resendInitialisation(d, scope.organisation, pending)
    const invitation = await issue(
      d,
      context,
      {
        email,
        organisationId,
        hospitalId,
        kind: pending.kind,
        zitadelSub: pending.zitadelSub,
        roleIds: pending.roleIds,
      },
      scope.delivery,
      { reasonCode: 'invitation.resend', replaces: pending },
    )
    return invitationResponse(invitation)
  }

  const existing = await createAppUserRepository(d.db).findByEmail(email)
  if (existing !== null) {
    if (existing.status !== 'active') throw conflict('This identity is not active.')
    await requireNoMembership(d.db, existing.id, scope.target)
    const invitation = await issue(
      d,
      context,
      { email, organisationId, hospitalId, kind: 'existing_user', zitadelSub: existing.zitadelSubject, roleIds },
      scope.delivery,
    )
    return invitationResponse(invitation)
  }

  if (scope.organisation.zitadelOrgId === null) {
    throw ruleViolation('The organisation is not provisioned yet.')
  }
  const zitadelOrgId = scope.organisation.zitadelOrgId
  const displayName = input.displayName?.trim() || email.split('@')[0] || email
  const subject = await d.identity.createHumanUser(zitadelOrgId, { email, displayName })
  try {
    const invitation = await issue(
      d,
      context,
      { email, organisationId, hospitalId, kind: 'new_user', zitadelSub: subject, roleIds },
      scope.delivery,
    )
    return invitationResponse(invitation)
  } catch (error) {
    // The identity exists but nobody will use it; deactivate rather than orphan it.
    await d.identity.deactivateUser(zitadelOrgId, subject).catch(() => undefined)
    throw error
  }
}
