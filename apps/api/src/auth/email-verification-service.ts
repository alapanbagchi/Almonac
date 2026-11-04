import type { AuditSink } from '../audit/audit-writer'
import type { DatabaseQuery } from '../db/pool'
import type { PendingRegistrationStore } from '../identity/pending-registration-repository'
import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../adapters/zitadel/client'
import { AppError } from '../shared/errors'
import { hashToken, isSessionToken } from '../shared/tokens'
import type { LoginRequestContext } from './login-service'

export interface VerifiedIdentityCreator {
  createVerifiedHumanUser(input: {
    email: string
    displayName: string
    passwordHash: string
  }): Promise<string>
}

export type TransactionRunner = <T>(
  run: (db: DatabaseQuery) => Promise<T>,
) => Promise<T>

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
 * the claim is marked consumed together with the audit record. The claim keeps
 * two concurrent clicks from creating two identities without holding a database
 * transaction across the provider round-trip.
 */
export class EmailVerificationService {
  constructor(
    private readonly pending: PendingRegistrationStore,
    private readonly identities: VerifiedIdentityCreator,
    private readonly audit: AuditSink,
    private readonly runInTransaction: TransactionRunner,
  ) {}

  async verify(token: unknown, context: LoginRequestContext): Promise<{ status: 'verified' }> {
    if (!isSessionToken(token)) {
      throw invalid()
    }
    const tokenHash = hashToken(token)

    const registration = await this.runInTransaction((db) =>
      this.pending.claim(db, tokenHash, CLAIM_LEASE_SECONDS),
    )
    if (registration === null) throw invalid()

    let userId: string
    try {
      userId = await this.identities.createVerifiedHumanUser({
        email: registration.email,
        displayName: registration.displayName,
        passwordHash: registration.passwordHash,
      })
    } catch (error) {
      if (error instanceof ZitadelUnavailableError) {
        await this.releaseClaim(registration.id, registration.claimId)
      }
      throw providerError(error)
    }

    try {
      await this.runInTransaction(async (db) => {
        const finished = await this.pending.finish(db, registration.id, registration.claimId)
        if (!finished) throw new InvalidVerificationError()
        await this.audit.write(
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
   * A failed provider call should not burn the link. If the release itself
   * fails, the claim expires after its lease and the original provider error is
   * the response the caller needs.
   */
  private async releaseClaim(id: string, claimId: string): Promise<void> {
    try {
      await this.runInTransaction((db) => this.pending.release(db, id, claimId))
    } catch {
      // Leave the claim to expire; exposing the release failure would hide the
      // provider outage that the user can retry.
    }
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
    return new AppError('AUTH_UNAVAILABLE', 503, 'Authentication is temporarily unavailable.')
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
