import { AppError } from '../../shared/errors'
import { hashToken } from '../../shared/tokens'
import { seal } from '../../shared/sealed'
import { createLoginSecrets } from '../../adapters/oidc/provider'
import { OidcUnavailableError } from '../../adapters/oidc/token-client'
import { createLoginAttemptRepository } from '../../repositories/login-attempt-repository'
import { clockOf, type AuthDependencies, type LoginRequestContext } from './dependencies'

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1_000
export const LOGIN_ATTEMPT_AAD = 'almonac:login-attempt:pkce'

const MAX_RETURN_TO_LENGTH = 2_048
const ENCODED_UNSAFE = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i
// Deliberately matches control characters: they never belong in a browser path.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

export interface LoginStartDto {
  readonly authorizationUrl: string
  readonly expiresAt: string
}

export class InvalidReturnToError extends Error {
  constructor() {
    super('returnTo must be an internal path')
    this.name = 'InvalidReturnToError'
  }
}

/**
 * Accept only an internal path. A return target must never become an open
 * redirect or a protocol-relative URL such as //attacker.example.
 */
export function normaliseReturnTo(value: unknown, fallback = '/'): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new InvalidReturnToError()

  const target = value.trim()
  if (
    target.length === 0 ||
    target.length > MAX_RETURN_TO_LENGTH ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\') ||
    CONTROL_CHARACTER.test(target) ||
    ENCODED_UNSAFE.test(target)
  ) {
    throw new InvalidReturnToError()
  }

  return target
}

/** Begin a login attempt. Only the state and nonce hashes are stored. */
export async function startLogin(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  returnTo: unknown,
): Promise<LoginStartDto> {
  return beginLoginAttempt(dependencies, context, returnTo, null)
}

/**
 * Shared with step-up: the only difference is who the attempt belongs to and
 * that the provider must re-authenticate the user.
 */
export async function beginLoginAttempt(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  returnTo: unknown,
  userId: string | null,
): Promise<LoginStartDto> {
  let target: string
  try {
    target = normaliseReturnTo(returnTo)
  } catch (error) {
    if (!(error instanceof InvalidReturnToError)) throw error
    throw new AppError('VALIDATION_FAILED', 400, 'returnTo must be an internal path.')
  }

  const now = clockOf(dependencies)()
  const secrets = createLoginSecrets()
  let authorizationUrl: string
  try {
    authorizationUrl = await dependencies.oidc.authorizationUrl({
      state: secrets.state,
      nonce: secrets.nonce,
      challenge: secrets.challenge,
      ...(userId === null ? {} : { prompt: 'login', maxAgeSeconds: 0 }),
    })
  } catch (error) {
    if (!(error instanceof OidcUnavailableError)) throw error
    throw unavailable()
  }
  const sealedVerifier = seal(secrets.verifier, dependencies.sealingKey, LOGIN_ATTEMPT_AAD)
  const expiresAt = new Date(
    now.getTime() + (dependencies.loginAttemptTtlMs ?? LOGIN_ATTEMPT_TTL_MS),
  )

  await createLoginAttemptRepository(dependencies.db).create({
    userId,
    stateHash: hashToken(secrets.state),
    nonceHash: hashToken(secrets.nonce),
    pkceVerifierCiphertext: sealedVerifier.ciphertext,
    keyVersion: sealedVerifier.keyVersion,
    returnTo: target,
    purpose: userId === null ? 'login' : 'step_up',
    ip: context.ip,
    userAgentHash: context.userAgentHash,
    expiresAt,
  })

  return { authorizationUrl, expiresAt: expiresAt.toISOString() }
}

function unavailable(): AppError {
  return new AppError(
    'AUTH_UNAVAILABLE',
    503,
    'Authentication is temporarily unavailable.',
  )
}
