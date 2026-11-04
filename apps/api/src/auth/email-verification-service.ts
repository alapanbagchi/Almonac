import type { AuditSink } from '../audit/audit-writer'
import type { DatabaseQuery } from '../db/pool'
import type { PendingRegistrationStore } from '../identity/pending-registration-repository'
import {
  ZitadelConflictError,
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../admin/zitadel-management-client'
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

class InvalidVerificationError extends Error {
  constructor() {
    super('verification token is invalid')
    this.name = 'InvalidVerificationError'
  }
}

/**
 * Turn a verified sign-up into a provider identity. The pending row is locked,
 * the provider user is created with the verified email and the stored bcrypt
 * hash, and the row is consumed in one transaction. The lock is what makes two
 * concurrent clicks produce exactly one identity.
 */
export class EmailVerificationService {
  constructor(
    private readonly pending: PendingRegistrationStore,
    private readonly identities: VerifiedIdentityCreator,
    private readonly audit: AuditSink,
    private readonly runInTransaction: TransactionRunner,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async verify(token: unknown, context: LoginRequestContext): Promise<{ status: 'verified' }> {
    if (!isSessionToken(token)) {
      throw invalid()
    }
    const tokenHash = hashToken(token)
    const now = this.clock()

    try {
      await this.runInTransaction(async (db) => {
        const registration = await this.pending.findForUpdate(db, tokenHash, now)
        if (registration === null) throw new InvalidVerificationError()

        const userId = await this.identities.createVerifiedHumanUser({
          email: registration.email,
          displayName: registration.displayName,
          passwordHash: registration.passwordHash,
        })
        const consumed = await this.pending.markConsumed(db, registration.id, now)
        if (!consumed) throw new InvalidVerificationError()
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
      if (error instanceof ZitadelConflictError) {
        throw new AppError(
          'EMAIL_TAKEN',
          409,
          'An account already uses this email address.',
        )
      }
      if (error instanceof ZitadelRejectedError) {
        throw new AppError(
          'REGISTRATION_REJECTED',
          422,
          'The account could not be created. Start again.',
        )
      }
      if (error instanceof ZitadelUnavailableError) {
        throw new AppError(
          'AUTH_UNAVAILABLE',
          503,
          'Authentication is temporarily unavailable.',
        )
      }
      throw error
    }
    return { status: 'verified' }
  }
}

function invalid(): AppError {
  return new AppError(
    'EMAIL_VERIFICATION_INVALID',
    422,
    'This verification link is not valid or has expired.',
  )
}
