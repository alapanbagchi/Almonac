import {
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../../adapters/zitadel/client'
import {
  InvalidAuthRequestError,
  MfaRequiredError,
} from '../../adapters/zitadel/login-client'
import { AppError } from '../../shared/errors'
import { normaliseEmail } from '../../shared/email'
import { isSessionToken } from '../../shared/tokens'
import type { AppUser } from '../../repositories/app-user-repository'
import type { AuthDependencies, LoginRequestContext } from './dependencies'
import { recordLoginFailure } from './complete-callback'
import { beginLoginAttempt } from './start-login'

const MAX_PASSWORD_LENGTH = 1_024

export interface PasswordLoginDto {
  readonly callbackUrl: string
}

export interface PasswordLoginInput {
  readonly email: string
  readonly password: string
  readonly returnTo?: unknown
}

export interface PasswordStepUpInput {
  readonly password: string
  readonly returnTo?: unknown
}

/**
 * Verify an email and password through the provider's session API and return
 * the code callback URL. The browser then follows that URL through the normal
 * callback route, which mints the opaque application session.
 */
export async function passwordLogin(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  input: PasswordLoginInput,
): Promise<PasswordLoginDto> {
  const loginName = normaliseEmail(input.email)
  if (loginName === null) {
    throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
  }
  assertPasswordLength(input.password)
  return authenticate(dependencies, context, loginName, input.password, input.returnTo, null)
}

/**
 * Re-authenticate an already signed-in user with their password. The provider
 * attempt belongs to the user, so the callback can rotate their session.
 */
export async function passwordStepUp(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  user: Pick<AppUser, 'id' | 'email'>,
  input: PasswordStepUpInput,
): Promise<PasswordLoginDto> {
  assertPasswordLength(input.password)
  return authenticate(dependencies, context, user.email, input.password, input.returnTo, user.id)
}

async function authenticate(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  loginName: string,
  password: string,
  returnTo: unknown,
  userId: string | null,
): Promise<PasswordLoginDto> {
  const attempt = await beginLoginAttempt(dependencies, context, returnTo, userId)
  const state = stateOf(attempt.authorizationUrl)
  if (state === null) {
    throw new AppError(
      'AUTH_UNAVAILABLE',
      503,
      'Authentication is temporarily unavailable.',
    )
  }

  try {
    const authRequestId = await dependencies.loginClient.start(attempt.authorizationUrl)
    const session = await dependencies.loginClient.signIn(loginName, password)
    const callbackUrl = await dependencies.loginClient.complete(authRequestId, session)
    if (stateOf(callbackUrl) !== state) throw new InvalidAuthRequestError()
    return { callbackUrl }
  } catch (error) {
    return await reject(dependencies, context, error, userId)
  }
}

function assertPasswordLength(password: string): void {
  if (password.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Authentication failed.')
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('VALIDATION_FAILED', 400, 'Request validation failed.')
  }
}

/** Record why the attempt failed and answer with the matching envelope. */
async function reject(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  error: unknown,
  userId: string | null,
): Promise<never> {
  const [reasonCode, failure] = failureOf(error)
  await recordLoginFailure(dependencies, context, reasonCode, userId)
  throw failure
}

/** What a provider failure means to the caller, and what the audit record calls it. */
function failureOf(error: unknown): [reasonCode: string, failure: AppError] {
  if (error instanceof MfaRequiredError) {
    return [
      'mfa_required',
      new AppError(
        'MFA_REQUIRED',
        403,
        'Multi-factor authentication is required for this account.',
      ),
    ]
  }
  if (error instanceof ZitadelRejectedError) {
    return ['invalid_credentials', new AppError('UNAUTHENTICATED', 401, 'Authentication failed.')]
  }
  if (error instanceof ZitadelUnavailableError || error instanceof InvalidAuthRequestError) {
    const reasonCode =
      error instanceof ZitadelUnavailableError ? 'identity_unavailable' : 'invalid_authorization'
    return [
      reasonCode,
      new AppError(
        'AUTH_UNAVAILABLE',
        503,
        'Authentication is temporarily unavailable.',
      ),
    ]
  }
  throw error
}

function stateOf(url: string): string | null {
  try {
    const state = new URL(url).searchParams.get('state')
    return state !== null && isSessionToken(state) ? state : null
  } catch {
    return null
  }
}