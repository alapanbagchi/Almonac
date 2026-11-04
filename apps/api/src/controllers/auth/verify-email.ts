import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../../admin/zitadel-management-client'
import { AppError } from '../../shared/errors'
import { hashToken, isSessionToken } from '../../shared/tokens'
import { createPendingRegistrationRepository } from '../../repositories/pending-registration-repository'
import { type AuthDependencies, type LoginRequestContext } from './dependencies'

export interface VerificationDto {
  readonly status: 'verified'
}

/** A claim older than this can be taken over after a crashed verification. */
const CLAIM_LEASE_SECONDS = 5 * 60

class InvalidVerificationError extends Error {
  constructor() {
    super('verification token is invalid')
    this.name = 'InvalidVerificationError'
  }
}

/**
 * Turn a verified sign-up into a provider identity. The pending row is claimed
 * in a short transaction, the provider is called outside any transaction, and
 * the claim is marked consumed together with the audit record.
 */
export async function verifyEmail(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  token: unknown,
): Promise<VerificationDto> {
  if (!isSessionToken(token)) {
    throw invalid()
  }
  const tokenHash = hashToken(token)

  const registration = await dependencies.transaction((db) =>
    createPendingRegistrationRepository(db).claim(tokenHash, CLAIM_LEASE_SECONDS),
  )
  if (registration === null) throw invalid()

  let userId: string
  try {
    userId = await dependencies.identities.createVerifiedHumanUser({
      email: registration.email,
      displayName: registration.displayName,
      passwordHash: registration.passwordHash,
    })
  } catch (error) {
    if (error instanceof ZitadelUnavailableError) {
      await releaseClaim(dependencies, registration.id, registration.claimId)
    }
    throw providerError(error)
  }

  try {
    await dependencies.transaction(async (db) => {
      const pending = createPendingRegistrationRepository(db)
      const finished = await pending.finish(registration.id, registration.claimId)
      if (!finished) throw new InvalidVerificationError()
      await dependencies.audit.write(
        {
          actorUserId: null,
          actorType: 'system',
          sessionId: null,
          organisationId: null,
          hospitalId: null,
          eventType: 'auth.signup_verified',
          outcome: 'success',
          targetType: 'identity',
          targetId: userId,
          requestId: context.requestId,
          ip: context.ip,
          userAgentHash: context.userAgentHash,
        },
        db,
      )
    })
  } catch (error) {
    if (error instanceof InvalidVerificationError) throw invalid()
    throw error
  }
  return { status: 'verified' }
}

/**
 * A failed provider call should not burn the link. If the release itself fails,
 * the claim expires after its lease and the original provider error is the
 * answer the caller needs.
 */
async function releaseClaim(
  dependencies: AuthDependencies,
  id: string,
  claimId: string,
): Promise<void> {
  try {
    await dependencies.transaction((db) =>
      createPendingRegistrationRepository(db).release(id, claimId),
    )
  } catch {
    // Leave the claim to expire; the provider outage is what the user retries.
  }
}

function providerError(error: unknown): unknown {
  if (error instanceof ZitadelConflictError) {
    return new AppError('CONFLICT', 409, 'An account already uses this email address.')
  }
  if (error instanceof ZitadelRejectedError) {
    return new AppError(
      'REGISTRATION_REJECTED',
      422,
      'The account could not be created. Start again.',
    )
  }
  if (error instanceof ZitadelUnavailableError) {
    return new AppError(
      'AUTH_UNAVAILABLE',
      503,
      'Authentication is temporarily unavailable.',
    )
  }
  return error
}

function invalid(): AppError {
  return new AppError(
    'EMAIL_VERIFICATION_INVALID',
    422,
    'This verification link is not valid or has expired.',
  )
}
