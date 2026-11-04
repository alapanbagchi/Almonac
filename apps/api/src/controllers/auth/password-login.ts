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
import type { AuthDependencies, LoginRequestContext } from './dependencies'
import { recordLoginFailure } from './complete-callback'
import { startLogin } from './start-login'

const MAX_PASSWORD_LENGTH = 1_024

export interface PasswordLoginDto {
  readonly callbackUrl: string
}

export interface PasswordLoginInput {
  readonly email: string
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
  if (input.password.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Authentication failed.')
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('VALIDATION_FAILED', 400, 'Request validation failed.')
  }

  const attempt = await startLogin(dependencies, context, input.returnTo)
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
    const session = await dependencies.loginClient.signIn(loginName, input.password)
    const callbackUrl = await dependencies.loginClient.complete(authRequestId, session)
    if (stateOf(callbackUrl) !== state) throw new InvalidAuthRequestError()
    return { callbackUrl }
  } catch (error) {
    return await reject(dependencies, context, error)
  }
}

/** Record why the attempt failed and answer with the matching envelope. */
async function reject(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  error: unknown,
): Promise<never> {
  const [reasonCode, failure] = failureOf(error)
  await recordLoginFailure(dependencies, context, reasonCode)
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
        'Multi-factor authentication is required. Use single sign-on.',
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
