import type { AuditEvent, AuditSink } from '../audit/audit-writer'
import type { SealingKey } from '../shared/sealed'
import { open, seal } from '../shared/sealed'
import { AppError } from '../shared/errors'
import { hashToken, isSessionToken } from '../shared/tokens'
import { safeName } from '../shared/log'
import { NO_METRICS, type Metrics } from '../shared/metrics'
import { LOGIN_ATTEMPT_AAD, SESSION_ID_TOKEN_HINT_AAD } from './aad'
import {
  InvalidIdTokenError,
  InvalidLoginAttemptError,
  OidcRejectedError,
  OidcUnavailableError,
} from './errors'
import type { LoginAttempt, LoginAttemptStore } from './login-attempt-repository'
import type { OidcProvider } from './oidc-provider'
import { createLoginSecrets } from './pkce'
import { normaliseReturnTo, InvalidReturnToError } from './return-to'
import type { VerifiedIdentity } from './id-token-verifier'

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1_000
const MAX_CODE_LENGTH = 4_096

export interface LoginStart {
  readonly authorizationUrl: string
  readonly expiresAt: Date
}

export interface LoginCompletion {
  readonly token: string
  readonly expiresAt: Date
  readonly returnTo: string
  readonly sessionId: string
  readonly userId: string
}

export interface LoginCompletionInput {
  readonly attempt: LoginAttempt
  readonly identity: VerifiedIdentity
  readonly idTokenHintCiphertext: Buffer
  readonly keyVersion: number
  readonly now: Date
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly requestId: string | null
}

export interface StepUpCompletionInput extends LoginCompletionInput {
  readonly sessionToken: string
}

export interface LoginCompletionStore {
  complete(input: LoginCompletionInput): Promise<LoginCompletion>
  completeStepUp(input: StepUpCompletionInput): Promise<LoginCompletion>
}

export class LoginRejectedError extends Error {
  constructor(
    readonly reason: string,
    readonly userId: string | null = null,
  ) {
    super('login was rejected')
    this.name = 'LoginRejectedError'
  }
}

export interface LoginRequestContext {
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly requestId: string | null
}

export interface LoginServiceOptions {
  readonly attempts: LoginAttemptStore
  readonly oidc: OidcProvider
  readonly completion: LoginCompletionStore
  readonly audit: AuditSink
  readonly metrics?: Metrics
  readonly sealingKey: SealingKey
  readonly clock?: () => Date
  readonly loginAttemptTtlMs?: number
}

/**
 * Start a login attempt and complete the authorization-code callback. The
 * state, nonce and PKCE verifier are generated here; only a hash of state and
 * nonce is stored, and the verifier is sealed with the session key.
 */
export class LoginService {
  private readonly metrics: Metrics
  private readonly clock: () => Date
  private readonly loginAttemptTtlMs: number

  constructor(private readonly options: LoginServiceOptions) {
    this.metrics = options.metrics ?? NO_METRICS
    this.clock = options.clock ?? (() => new Date())
    this.loginAttemptTtlMs = options.loginAttemptTtlMs ?? LOGIN_ATTEMPT_TTL_MS

    if (this.loginAttemptTtlMs <= 0) {
      throw new Error('login attempt lifetime must be positive')
    }
  }

  async start(returnTo: unknown, context: LoginRequestContext): Promise<LoginStart> {
    return this.begin(returnTo, context, null)
  }

  /**
   * Start a step-up attempt for an already-authenticated user. The provider must
   * re-authenticate the user even when the identity-provider session is valid.
   */
  async startStepUp(
    userId: string,
    returnTo: unknown,
    context: LoginRequestContext,
  ): Promise<LoginStart> {
    return this.begin(returnTo, context, userId)
  }

  /**
   * Record a rejected first-party attempt. The audit write stays best effort,
   * exactly as it does for a rejected callback.
   */
  async recordFailure(reasonCode: string, context: LoginRequestContext): Promise<void> {
    await this.fail(reasonCode, null, context)
  }

  private async begin(
    returnTo: unknown,
    context: LoginRequestContext,
    userId: string | null,
  ): Promise<LoginStart> {
    let target: string
    try {
      target = normaliseReturnTo(returnTo)
    } catch (error) {
      if (!(error instanceof InvalidReturnToError)) throw error
      throw new AppError('VALIDATION_FAILED', 400, 'returnTo must be an internal path.')
    }

    const now = this.clock()
    const secrets = createLoginSecrets()
    let authorizationUrl: string
    try {
      authorizationUrl = await this.options.oidc.authorizationUrl({
        state: secrets.state,
        nonce: secrets.nonce,
        challenge: secrets.challenge,
        ...(userId === null ? {} : { prompt: 'login', maxAgeSeconds: 0 }),
      })
    } catch (error) {
      if (!(error instanceof OidcUnavailableError)) throw error
      throw unavailable()
    }
    const sealedVerifier = seal(secrets.verifier, this.options.sealingKey, LOGIN_ATTEMPT_AAD)
    const expiresAt = new Date(now.getTime() + this.loginAttemptTtlMs)

    await this.options.attempts.create({
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

    return { authorizationUrl, expiresAt }
  }

  async complete(
    code: string,
    state: string,
    context: LoginRequestContext,
    sessionToken: string | null = null,
  ): Promise<LoginCompletion> {
    if (!isSessionToken(state) || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      await this.fail('invalid_callback', null, context)
      throw authFailed()
    }

    const now = this.clock()
    const attempt = await this.options.attempts.consume(hashToken(state), now)
    if (attempt === null) {
      await this.fail('invalid_attempt', null, context)
      throw authFailed()
    }
    const stepUpToken =
      attempt.purpose === 'step_up' && isSessionToken(sessionToken ?? '') ? sessionToken : null
    if (attempt.purpose === 'step_up' && stepUpToken === null) {
      await this.fail('missing_session', attempt.userId, context)
      throw authFailed()
    }

    let identity: VerifiedIdentity
    let completionInput: LoginCompletionInput
    try {
      const verifier = open(
        { ciphertext: attempt.pkceVerifierCiphertext, keyVersion: attempt.keyVersion },
        this.options.sealingKey,
        LOGIN_ATTEMPT_AAD,
      )
      const idToken = await this.options.oidc.exchangeCode(code, verifier)
      const verified = await this.options.oidc.verifyIdToken(idToken, attempt.nonceHash)
      // The provider may report an authentication time up to the verification
      // tolerance ahead of this clock. Clamp it so session timestamps stay
      // ordered and a small clock difference cannot fail the login.
      identity = verified.authTime > now ? { ...verified, authTime: now } : verified
      const sealedHint = seal(identity.idToken, this.options.sealingKey, SESSION_ID_TOKEN_HINT_AAD)
      completionInput = {
        attempt,
        identity,
        idTokenHintCiphertext: sealedHint.ciphertext,
        keyVersion: sealedHint.keyVersion,
        now,
        ip: attempt.ip ?? context.ip,
        userAgentHash: attempt.userAgentHash ?? context.userAgentHash,
        requestId: context.requestId,
      }
    } catch (error) {
      throw await this.rejection(error, context)
    }

    const completed =
      stepUpToken === null
        ? await this.options.completion.complete(completionInput)
        : await this.options.completion.completeStepUp({ ...completionInput, sessionToken: stepUpToken })
    this.metrics.count('auth.login_succeeded', {
      purpose: stepUpToken === null ? 'login' : 'step_up',
    })
    return completed
  }

  /** Map a callback failure to the response, after recording why it failed. */
  private async rejection(error: unknown, context: LoginRequestContext): Promise<unknown> {
    if (error instanceof OidcUnavailableError) {
      await this.fail('identity_unavailable', null, context)
      return unavailable()
    }
    if (error instanceof InvalidIdTokenError) {
      this.metrics.count('auth.id_token_rejected', { reason: 'invalid' })
    }
    if (
      error instanceof OidcRejectedError ||
      error instanceof InvalidIdTokenError ||
      error instanceof InvalidLoginAttemptError ||
      error instanceof LoginRejectedError
    ) {
      const rejected = error instanceof LoginRejectedError
      await this.fail(rejected ? error.reason : 'token_rejected', rejected ? error.userId : null, context)
      return authFailed()
    }
    return error
  }

  /** A failed login is audited best effort; the audit must not mask the error. */
  private async fail(
    reasonCode: string,
    userId: string | null,
    context: LoginRequestContext,
  ): Promise<void> {
    this.metrics.count('auth.login_failed', { reason: reasonCode })
    const event: AuditEvent = {
      actorUserId: userId,
      actorType: userId === null ? 'system' : 'user',
      sessionId: null,
      organisationId: null,
      hospitalId: null,
      eventType: 'auth.login_failed',
      outcome: 'failure',
      requestId: context.requestId,
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { reason_code: reasonCode },
    }

    try {
      await this.options.audit.write(event)
    } catch (error) {
      console.error('[api] login audit failed:', safeName(error))
    }
  }
}

function authFailed(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Authentication failed.')
}

function unavailable(): AppError {
  return new AppError('AUTH_UNAVAILABLE', 503, 'Authentication is temporarily unavailable.')
}
