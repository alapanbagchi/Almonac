import {
  ZitadelRejectedError,
  ZitadelUnavailableError,
} from '../admin/zitadel-management-client'
import { AppError } from '../shared/errors'
import { normaliseEmail } from '../shared/email'
import { isSessionToken } from '../shared/tokens'
import type { LoginRequestContext, LoginStart } from './login-service'
import {
  InvalidAuthRequestError,
  MfaRequiredError,
  type LoginClient,
} from './zitadel-session-client'

const MAX_PASSWORD_LENGTH = 1_024

export interface PasswordLoginResult {
  readonly callbackUrl: string
}

/** The parts of the login flow this service drives. */
export interface LoginFlow {
  start(returnTo: unknown, context: LoginRequestContext): Promise<LoginStart>
  recordFailure(reasonCode: string, context: LoginRequestContext): Promise<void>
}

/**
 * Verify an email and password through the provider's session API and return
 * the code callback URL. The browser then follows that URL through the normal
 * callback route, which mints the opaque application session.
 */
export class PasswordLoginService {
  constructor(
    private readonly login: LoginFlow,
    private readonly client: LoginClient,
  ) {}

  async start(
    email: unknown,
    password: unknown,
    returnTo: unknown,
    context: LoginRequestContext,
  ): Promise<PasswordLoginResult> {
    const loginName = normaliseEmail(email)
    if (loginName === null) {
      throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Authentication failed.')
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new AppError('VALIDATION_FAILED', 400, 'Request validation failed.')
    }

    const attempt = await this.login.start(returnTo, context)
    const state = stateOf(attempt.authorizationUrl)
    if (state === null) {
      throw new AppError('AUTH_UNAVAILABLE', 503, 'Authentication is temporarily unavailable.')
    }

    try {
      const authRequestId = await this.client.start(attempt.authorizationUrl)
      const session = await this.client.signIn(loginName, password)
      const callbackUrl = await this.client.complete(authRequestId, session)
      if (stateOf(callbackUrl) !== state) throw new InvalidAuthRequestError()
      return { callbackUrl }
    } catch (error) {
      return await this.reject(error, context)
    }
  }

  private async reject(error: unknown, context: LoginRequestContext): Promise<never> {
    if (error instanceof MfaRequiredError) {
      await this.login.recordFailure('mfa_required', context)
      throw new AppError(
        'MFA_REQUIRED',
        403,
        'Multi-factor authentication is required. Use single sign-on.',
      )
    }
    if (error instanceof ZitadelRejectedError) {
      await this.login.recordFailure('invalid_credentials', context)
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication failed.')
    }
    if (error instanceof ZitadelUnavailableError) {
      await this.login.recordFailure('identity_unavailable', context)
      throw new AppError('AUTH_UNAVAILABLE', 503, 'Authentication is temporarily unavailable.')
    }
    if (error instanceof InvalidAuthRequestError) {
      await this.login.recordFailure('invalid_authorization', context)
      throw new AppError('AUTH_UNAVAILABLE', 503, 'Authentication is temporarily unavailable.')
    }
    throw error
  }
}

function stateOf(url: string): string | null {
  try {
    const state = new URL(url).searchParams.get('state')
    return state !== null && isSessionToken(state) ? state : null
  } catch {
    return null
  }
}
