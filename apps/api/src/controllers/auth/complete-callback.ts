import type { AuditEvent } from '../../shared/audit-writer'
import type { DatabaseQuery } from '../../db/pool'
import { hasSqlState, rowRecord, stringField } from '../../db/rows'
import { AppError } from '../../shared/errors'
import { safeName } from '../../shared/log'
import { open, seal } from '../../shared/sealed'
import { hashToken, isSessionToken } from '../../shared/tokens'
import { OidcRejectedError, OidcUnavailableError } from '../../adapters/oidc/token-client'
import { InvalidIdTokenError, type VerifiedIdentity } from '../../adapters/oidc/verifier'
import {
  AppUserEmailConflictError,
  createAppUserRepository,
  type AppUser,
} from '../../repositories/app-user-repository'
import { createLoginAttemptRepository, type LoginAttempt } from '../../repositories/login-attempt-repository'
import { createSessionRepository } from '../../repositories/session-repository'
import {
  clockOf,
  metricsOf,
  type AuthDependencies,
  type LoginRequestContext,
} from './dependencies'
import { SESSION_ID_TOKEN_HINT_AAD, createSessionService } from './session'
import { LOGIN_ATTEMPT_AAD } from './start-login'

const MAX_CODE_LENGTH = 4_096

interface PendingInvitation {
  readonly id: string
  readonly organisationId: string
  readonly hospitalId: string | null
}

const PENDING_INVITATION_QUERY = `
  select id, organisation_id, hospital_id
  from identity.invitation
  where email = $1
    and status = 'pending'
    and expires_at > $2
    and kind = 'new_user'
  order by created_at, id
  for update
`

export interface LoginCompletion {
  readonly token: string
  readonly expiresAt: Date
  readonly returnTo: string
  readonly sessionId: string
  readonly userId: string
}

export interface CallbackDto {
  readonly token: string
  readonly expiresAt: string
  readonly returnTo: string
}

interface LoginCompletionInput {
  readonly attempt: LoginAttempt
  readonly identity: VerifiedIdentity
  readonly idTokenHintCiphertext: Buffer
  readonly keyVersion: number
  readonly now: Date
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly requestId: string
}

interface StepUpCompletionInput extends LoginCompletionInput {
  readonly sessionToken: string
}

/**
 * A login the application refuses. The reason is kept for the audit record and
 * never reaches the caller, who only learns that authentication failed.
 */
export class LoginRejectedError extends Error {
  constructor(
    readonly reason: string,
    readonly userId: string | null = null,
  ) {
    super('login was rejected')
    this.name = 'LoginRejectedError'
  }
}

/**
 * Complete the authorization-code callback. The attempt is consumed before the
 * provider is asked anything, so a replayed state can never mint a second
 * session. The user, accepted invitations, session and audit record commit
 * together.
 */
export async function completeCallback(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  input: { readonly code: string; readonly state: string; readonly sessionToken: string | null },
): Promise<CallbackDto> {
  if (!isSessionToken(input.state) || input.code.length === 0 || input.code.length > MAX_CODE_LENGTH) {
    await recordLoginFailure(dependencies, context, 'invalid_callback')
    throw authFailed()
  }

  const now = clockOf(dependencies)()
  const attempt = await createLoginAttemptRepository(dependencies.db).consume(
    hashToken(input.state),
    now,
  )
  if (attempt === null) {
    await recordLoginFailure(dependencies, context, 'invalid_attempt')
    throw authFailed()
  }
  const stepUpToken =
    attempt.purpose === 'step_up' && isSessionToken(input.sessionToken ?? '')
      ? input.sessionToken
      : null
  if (attempt.purpose === 'step_up' && stepUpToken === null) {
    await recordLoginFailure(dependencies, context, 'missing_session', attempt.userId)
    throw authFailed()
  }

  let identity: VerifiedIdentity
  let completionInput: LoginCompletionInput
  try {
    const verifier = open(
      {
        ciphertext: attempt.pkceVerifierCiphertext,
        keyVersion: attempt.keyVersion,
      },
      dependencies.sealingKey,
      LOGIN_ATTEMPT_AAD,
    )
    const idToken = await dependencies.oidc.exchangeCode(input.code, verifier)
    const verified = await dependencies.oidc.verifyIdToken(idToken, attempt.nonceHash)
    // The provider may report an authentication time up to the verification
    // tolerance ahead of this clock. Clamp it so session timestamps stay
    // ordered and a small clock difference cannot fail the login.
    identity = verified.authTime > now ? { ...verified, authTime: now } : verified
    const sealedHint = seal(
      identity.idToken,
      dependencies.sealingKey,
      SESSION_ID_TOKEN_HINT_AAD,
    )
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
    throw await rejection(dependencies, error, context)
  }

  let completed: LoginCompletion
  try {
    completed =
      stepUpToken === null
        ? await completeLogin(dependencies, completionInput)
        : await completeStepUp(dependencies, {
            ...completionInput,
            sessionToken: stepUpToken,
          })
  } catch (error) {
    // Refusals after the token exchange are still authentication failures.
    throw await rejection(dependencies, error, context)
  }
  metricsOf(dependencies).count('auth.login_succeeded', {
    purpose: stepUpToken === null ? 'login' : 'step_up',
  })

  return {
    token: completed.token,
    expiresAt: completed.expiresAt.toISOString(),
    returnTo: completed.returnTo,
  }
}

/** Record a failed attempt. The audit stays best effort; it must not mask the failure. */
export async function recordLoginFailure(
  dependencies: AuthDependencies,
  context: LoginRequestContext,
  reasonCode: string,
  userId: string | null = null,
): Promise<void> {
  metricsOf(dependencies).count('auth.login_failed', { reason: reasonCode })
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
    await dependencies.audit.write(event)
  } catch (error) {
    console.error('[api] login audit failed:', safeName(error))
  }
}

async function completeLogin(
  dependencies: AuthDependencies,
  input: LoginCompletionInput,
): Promise<LoginCompletion> {
  return dependencies.transaction(async (db) => {
    const users = createAppUserRepository(db)
    let user: AppUser
    try {
      user = await users.upsertFromIdentity({
        identityIssuer: input.identity.issuer,
        zitadelSubject: input.identity.subject,
        email: input.identity.email,
        emailVerifiedAt: input.identity.emailVerifiedAt,
        displayName: input.identity.displayName,
        homeOrganisationId: null,
      })
    } catch (error) {
      if (error instanceof AppUserEmailConflictError) {
        throw new LoginRejectedError('email_conflict')
      }
      throw error
    }

    if (user.status !== 'active') {
      throw new LoginRejectedError('user_inactive', user.id)
    }

    for (const invitation of await pendingInvitations(db, user, input.now)) {
      await acceptInvitation(dependencies, db, user, invitation, input)
    }

    const loggedIn = await users.markLogin(user.id, input.now)
    if (loggedIn === null) throw new LoginRejectedError('user_inactive', user.id)

    return mintSession(dependencies, db, loggedIn, input)
  })
}

/**
 * Rotate an existing session after a step-up. The attempt, the old session and
 * the new token must all belong to the same active user.
 */
async function completeStepUp(
  dependencies: AuthDependencies,
  input: StepUpCompletionInput,
): Promise<LoginCompletion> {
  return dependencies.transaction(async (db) => {
    const userId = input.attempt.userId
    if (userId === null) throw new LoginRejectedError('invalid_attempt')

    const user = await createAppUserRepository(db).findById(userId)
    if (user === null || user.status !== 'active') {
      throw new LoginRejectedError('user_inactive', user?.id ?? null)
    }
    if (
      user.identityIssuer !== input.identity.issuer ||
      user.zitadelSubject !== input.identity.subject
    ) {
      throw new LoginRejectedError('identity_mismatch', user.id)
    }

    const sessions = sessionsOn(db, input.now)
    const current = await sessions.findByToken(input.sessionToken)
    if (current === null || current.userId !== user.id) {
      throw new LoginRejectedError('session_mismatch', user.id)
    }

    const issued = await sessions.rotate(input.sessionToken, {
      amr: input.identity.amr,
      authTime: input.identity.authTime,
      aal: input.identity.aal,
      acr: input.identity.acr,
      oidcSid: input.identity.sid,
      idTokenHintCiphertext: input.idTokenHintCiphertext,
      keyVersion: input.keyVersion,
    })
    if (issued === null) throw new LoginRejectedError('session_expired', user.id)

    await dependencies.audit.write(
      {
        actorUserId: user.id,
        actorType: 'user',
        sessionId: issued.session.id,
        organisationId: null,
        hospitalId: null,
        eventType: 'auth.step_up',
        outcome: 'success',
        targetType: 'session',
        targetId: issued.session.id,
        requestId: input.requestId,
        ip: input.ip,
        userAgentHash: input.userAgentHash,
        metadata: {
          session_id: issued.session.id,
          amr: input.identity.amr.join(','),
        },
      },
      db,
    )

    return {
      token: issued.token,
      expiresAt: issued.session.absoluteExpiresAt,
      returnTo: input.attempt.returnTo,
      sessionId: issued.session.id,
      userId: user.id,
    }
  })
}

async function mintSession(
  dependencies: AuthDependencies,
  db: DatabaseQuery,
  user: AppUser,
  input: LoginCompletionInput,
): Promise<LoginCompletion> {
  const issued = await sessionsOn(db, input.now).mint({
    userId: user.id,
    identityIssuer: input.identity.issuer,
    zitadelSessionId: null,
    oidcSid: input.identity.sid,
    acr: input.identity.acr,
    idTokenHintCiphertext: input.idTokenHintCiphertext,
    keyVersion: input.keyVersion,
    amr: input.identity.amr,
    authTime: input.identity.authTime,
    aal: input.identity.aal,
    ip: input.ip,
    userAgentHash: input.userAgentHash,
  })

  await dependencies.audit.write(
    {
      actorUserId: user.id,
      actorType: 'user',
      sessionId: issued.session.id,
      organisationId: null,
      hospitalId: null,
      eventType: 'auth.login',
      outcome: 'success',
      targetType: 'user',
      targetId: user.id,
      requestId: input.requestId,
      ip: input.ip,
      userAgentHash: input.userAgentHash,
      metadata: { session_id: issued.session.id },
    },
    db,
  )

  return {
    token: issued.token,
    expiresAt: issued.session.absoluteExpiresAt,
    returnTo: input.attempt.returnTo,
    sessionId: issued.session.id,
    userId: user.id,
  }
}

/** Sessions read and written on the caller's transaction. */
function sessionsOn(db: DatabaseQuery, now: Date) {
  return createSessionService({
    store: createSessionRepository(db),
    clock: () => now,
  })
}

async function pendingInvitations(
  db: DatabaseQuery,
  user: AppUser,
  now: Date,
): Promise<PendingInvitation[]> {
  // An unverified address cannot prove ownership of an invitation mailbox.
  if (user.emailVerifiedAt === null) return []

  const result = await db.query(PENDING_INVITATION_QUERY, [user.email, now])

  return result.rows.map((value) => {
    const row = rowRecord(value)
    return {
      id: stringField(row, 'id'),
      organisationId: stringField(row, 'organisation_id'),
      hospitalId: row.hospital_id === null ? null : stringField(row, 'hospital_id'),
    }
  })
}

async function acceptInvitation(
  dependencies: AuthDependencies,
  db: DatabaseQuery,
  user: AppUser,
  invitation: PendingInvitation,
  input: LoginCompletionInput,
): Promise<void> {
  let membership
  try {
    membership = await db.query(
      `insert into control.membership (user_id, organisation_id, hospital_id)
       values ($1, $2, $3)
       returning id`,
      [user.id, invitation.organisationId, invitation.hospitalId],
    )
  } catch (error) {
    if (hasSqlState(error, '23P01', '23505')) {
      throw new LoginRejectedError('membership_conflict', user.id)
    }
    throw error
  }
  const membershipId = stringField(rowRecord(membership.rows[0]), 'id')

  await db.query(
    `insert into control.membership_role
       (membership_id, role_id, assigned_by)
     select $1, invitation_role.role_id, invitation.invited_by
       from control.invitation_role as invitation_role
       join identity.invitation as invitation
         on invitation.id = invitation_role.invitation_id
      where invitation_role.invitation_id = $2`,
    [membershipId, invitation.id],
  )

  await db.query(
    `update identity.invitation
        set status = 'accepted', accepted_at = now(), accepted_by_user_id = $2
      where id = $1 and status = 'pending'`,
    [invitation.id, user.id],
  )

  await db.query(
    `update identity.app_user
        set home_organisation_id = $2
      where id = $1 and home_organisation_id is null`,
    [user.id, invitation.organisationId],
  )

  await dependencies.audit.write(
    {
      actorUserId: user.id,
      actorType: 'user',
      sessionId: null,
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
      eventType: 'invitation.accept',
      outcome: 'success',
      targetType: 'invitation',
      targetId: invitation.id,
      requestId: input.requestId,
      ip: input.ip,
      userAgentHash: input.userAgentHash,
      metadata: { invitation_id: invitation.id },
    },
    db,
  )
}

/** Map a callback failure to the response, after recording why it failed. */
async function rejection(
  dependencies: AuthDependencies,
  error: unknown,
  context: LoginRequestContext,
): Promise<unknown> {
  if (error instanceof OidcUnavailableError) {
    await recordLoginFailure(dependencies, context, 'identity_unavailable')
    return unavailable()
  }
  if (error instanceof InvalidIdTokenError) {
    metricsOf(dependencies).count('auth.id_token_rejected', { reason: 'invalid' })
  }
  if (
    error instanceof OidcRejectedError ||
    error instanceof InvalidIdTokenError ||
    error instanceof LoginRejectedError
  ) {
    const rejected = error instanceof LoginRejectedError
    await recordLoginFailure(
      dependencies,
      context,
      rejected ? error.reason : 'token_rejected',
      rejected ? error.userId : null,
    )
    return authFailed()
  }
  return error
}

function authFailed(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Authentication failed.')
}

function unavailable(): AppError {
  return new AppError(
    'AUTH_UNAVAILABLE',
    503,
    'Authentication is temporarily unavailable.',
  )
}
