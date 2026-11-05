import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../../adapters/zitadel/client'
import { createAppUserRepository } from '../../repositories/app-user-repository'
import { createInvitationRepository } from '../../repositories/invitation-repository'
import { AppError, conflict, notFound, ruleViolation } from '../../shared/errors'
import { normaliseEmail } from '../../shared/email'
import { hashToken } from '../../shared/tokens'
import { clockOf, type AuthDependencies, type LoginRequestContext } from './dependencies'
import { assertStrongPassword } from './password-policy'
import { normaliseDisplayName } from './profile'
import { passwordLogin, type PasswordLoginDto } from './password-login'

export interface ClaimInvitationInput {
  readonly token: string
  readonly fullName: string
  readonly password: string
  readonly returnTo?: unknown
}

/**
 * Claim a new-user invitation: create the provider account with the chosen
 * password, then run the normal password login so the browser receives a code
 * callback. The callback accepts the invitation by matching the email address.
 */
export async function claimInvitation(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  input: ClaimInvitationInput,
): Promise<PasswordLoginDto> {
  const invitation = await createInvitationRepository(dependencies.db).findByTokenHash(
    hashToken(input.token),
  )
  if (invitation === null) throw notFound('Invitation not found.')
  if (invitation.status !== 'pending') throw conflict('Invitation is no longer pending.')
  if (invitation.expiresAt <= clockOf(dependencies)()) {
    throw conflict('Invitation has expired.')
  }
  if (invitation.kind !== 'new_user' || invitation.zitadelSub !== null) {
    throw ruleViolation('This invitation must be accepted by signing in.')
  }

  const email = normaliseEmail(invitation.email)
  if (email === null) throw ruleViolation('Invitation email is not valid.')
  if ((await createAppUserRepository(dependencies.db).findByEmail(email)) !== null) {
    throw conflict('An account already uses this email address.')
  }

  const displayName = normaliseDisplayName(input.fullName)
  assertStrongPassword(input.password)
  await createProviderAccount(dependencies, email, displayName, input.password)

  await dependencies.audit.write({
    actorUserId: null,
    actorType: 'system',
    sessionId: null,
    organisationId: invitation.organisationId,
    hospitalId: invitation.hospitalId,
    eventType: 'auth.invitation_registered',
    outcome: 'success',
    targetType: 'invitation',
    targetId: invitation.id,
    requestId: context.requestId,
    ip: context.ip,
    userAgentHash: context.userAgentHash,
    metadata: { invitation_id: invitation.id },
  })

  return passwordLogin(dependencies, context, {
    email,
    password: input.password,
    returnTo: input.returnTo,
  })
}

/** The provider creates the account with the hash, never the plaintext. */
async function createProviderAccount(
  dependencies: AuthDependencies,
  email: string,
  displayName: string,
  password: string,
): Promise<void> {
  try {
    await dependencies.identities.createVerifiedHumanUser({
      email,
      displayName,
      passwordHash: await dependencies.passwords.hash(password),
    })
  } catch (error) {
    if (error instanceof ZitadelConflictError) {
      throw conflict('An account already uses this email address.')
    }
    if (error instanceof ZitadelUnavailableError) {
      throw new AppError(
        'AUTH_UNAVAILABLE',
        503,
        'Authentication is temporarily unavailable.',
      )
    }
    if (error instanceof ZitadelRejectedError) {
      throw ruleViolation('The account could not be created.')
    }
    throw error
  }
}
