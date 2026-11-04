import type { AppUser } from '../identity/app-user-repository'
import type {
  NewPendingRegistration,
  PendingRegistrationStore,
} from '../identity/pending-registration-repository'
import type { AuditSink } from '../audit/audit-writer'
import { normaliseEmail } from '../shared/email'
import { AppError } from '../shared/errors'
import { mintToken } from '../shared/tokens'
import type { LoginRequestContext } from './login-service'
import type { PasswordHasher } from './password-hash'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72
export const MIN_NAME_LENGTH = 2
export const MAX_NAME_LENGTH = 200
export const VERIFICATION_TTL_MS = 30 * 60 * 1000

const UPPER = /[A-Z]/
const LOWER = /[a-z]/
const DIGIT = /[0-9]/
const SYMBOL = /[^A-Za-z0-9]/

export interface RegistrationInput {
  readonly fullName: string
  readonly email: string
  readonly password: string
}

export interface RegistrationUsers {
  findByEmail(email: string): Promise<AppUser | null>
}

export interface VerificationMailer {
  send(input: { to: string; token: string; expiresAt: Date }): Promise<void>
}

/**
 * Hold a sign-up until the person proves control of the email address. No
 * provider identity exists yet, so an unverified address cannot log in. The
 * provider user is created by EmailVerificationService with the stored hash.
 */
export class RegistrationService {
  constructor(
    private readonly users: RegistrationUsers,
    private readonly pending: PendingRegistrationStore,
    private readonly mailer: VerificationMailer,
    private readonly audit: AuditSink,
    private readonly passwords: PasswordHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async register(
    input: RegistrationInput,
    context: LoginRequestContext,
  ): Promise<{ status: 'verification_sent' }> {
    const email = normaliseEmail(input.email)
    if (email === null) {
      throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
    }
    const displayName = input.fullName.trim().replace(/\s+/g, ' ')
    if (displayName.length < MIN_NAME_LENGTH || displayName.length > MAX_NAME_LENGTH) {
      throw new AppError('INVALID_NAME', 422, 'Full name is not valid.')
    }
    if (!isStrongPassword(input.password)) {
      throw new AppError(
        'INVALID_PASSWORD',
        422,
        'Password must be 8 to 72 characters and include upper case, lower case, a number and a symbol.',
      )
    }
    if ((await this.users.findByEmail(email)) !== null) {
      throw new AppError(
        'EMAIL_TAKEN',
        409,
        'An account already uses this email address.',
      )
    }

    const now = this.clock()
    const { token, tokenHash } = mintToken()
    const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS)
    const pending: NewPendingRegistration = {
      email,
      displayName,
      passwordHash: await this.passwords.hash(input.password),
      tokenHash,
      expiresAt,
      requestedIp: context.ip,
      userAgentHash: context.userAgentHash,
    }
    await this.pending.replace(pending)
    await this.audit.write({
      actorUserId: null,
      actorType: 'system',
      sessionId: null,
      organisationId: null,
      hospitalId: null,
      eventType: 'auth.signup_requested',
      outcome: 'success',
      targetType: 'identity',
      targetId: null,
      requestId: context.requestId,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
    })

    try {
      await this.mailer.send({ to: email, token, expiresAt })
    } catch {
      throw new AppError(
        'MAIL_UNAVAILABLE',
        503,
        'The verification email could not be sent. Try again shortly.',
      )
    }
    return { status: 'verification_sent' }
  }
}

function isStrongPassword(value: string): boolean {
  return (
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH &&
    UPPER.test(value) &&
    LOWER.test(value) &&
    DIGIT.test(value) &&
    SYMBOL.test(value)
  )
}
