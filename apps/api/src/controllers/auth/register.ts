import { AppError } from '../../shared/errors'
import { normaliseEmail } from '../../shared/email'
import { mintToken } from '../../shared/tokens'
import { createAppUserRepository } from '../../repositories/app-user-repository'
import { createPendingRegistrationRepository } from '../../repositories/pending-registration-repository'
import { clockOf, type AuthDependencies, type LoginRequestContext } from './dependencies'
import { assertStrongPassword } from './password-policy'
import { normaliseDisplayName } from './profile'

export const VERIFICATION_TTL_MS = 30 * 60 * 1000

export interface RegistrationInput {
  readonly fullName: string
  readonly email: string
  readonly password: string
}

export interface RegistrationDto {
  readonly status: 'verification_sent'
}

/**
 * Hold a sign-up until the person proves control of the email address. No
 * provider identity exists yet, so an unverified address cannot log in.
 */
export async function register(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  input: RegistrationInput,
): Promise<RegistrationDto> {
  const email = normaliseEmail(input.email)
  if (email === null) {
    throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
  }
  const displayName = normaliseDisplayName(input.fullName)
  assertStrongPassword(input.password)

  const users = createAppUserRepository(dependencies.db)
  if ((await users.findByEmail(email)) !== null) {
    throw new AppError('CONFLICT', 409, 'An account already uses this email address.')
  }

  const now = clockOf(dependencies)()
  const { token, tokenHash } = mintToken()
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS)
  await createPendingRegistrationRepository(dependencies.db).replace({
    email,
    displayName,
    passwordHash: await dependencies.passwords.hash(input.password),
    tokenHash,
    expiresAt,
    requestedIp: context.ip,
    userAgentHash: context.userAgentHash,
  })
  await dependencies.audit.write({
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
    await dependencies.mailer.send({ to: email, token, expiresAt })
  } catch {
    throw new AppError(
      'MAIL_UNAVAILABLE',
      503,
      'The verification email could not be sent. Try again shortly.',
    )
  }
  return { status: 'verification_sent' }
}