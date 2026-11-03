import type { Pool } from 'pg'
import { AuditWriter } from '../audit/audit-writer'
import type { DatabaseQuery, DatabaseResult } from '../db/pool'
import { withTransaction } from '../db/pool'
import { rowRecord, stringField } from '../db/rows'
import {
  AppUserEmailConflictError,
  AppUserRepository,
  type AppUser,
} from '../identity/app-user-repository'
import { SessionRepository } from '../identity/session-repository'
import { SessionService } from '../identity/session-service'
import type {
  LoginCompletion,
  LoginCompletionInput,
  LoginCompletionStore,
} from './login-service'
import { LoginRejectedError } from './login-service'

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
    and (kind = 'new_user' or zitadel_sub = $3)
  order by created_at, id
  for update
`

/**
 * Complete a login inside one database transaction. The user, accepted
 * invitations, session and audit record commit together; any failure rolls
 * the whole login back. A session token is returned once and only its hash is
 * stored.
 */
export class PostgresLoginStore implements LoginCompletionStore {
  constructor(private readonly pool: Pool) {}

  async complete(input: LoginCompletionInput): Promise<LoginCompletion> {
    return withTransaction(this.pool, (db) => this.completeInTransaction(db, input))
  }

  private async completeInTransaction(
    db: DatabaseQuery,
    input: LoginCompletionInput,
  ): Promise<LoginCompletion> {
    const users = new AppUserRepository(db)
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

    const invitations = await this.pendingInvitations(
      db,
      user,
      input.identity.subject,
      input.now,
    )
    for (const invitation of invitations) {
      await this.acceptInvitation(db, user, invitation, input)
    }

    const loggedIn = await users.markLogin(user.id, input.now)
    if (loggedIn === null) throw new LoginRejectedError('user_inactive', user.id)
    user = loggedIn

    const sessions = new SessionService({
      store: new SessionRepository(db),
      clock: () => input.now,
    })
    const issued = await sessions.mint({
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

    await new AuditWriter(db).write({
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
    })

    return {
      token: issued.token,
      expiresAt: issued.session.absoluteExpiresAt,
      returnTo: input.attempt.returnTo,
      sessionId: issued.session.id,
      userId: user.id,
    }
  }

  private async pendingInvitations(
    db: DatabaseQuery,
    user: AppUser,
    subject: string,
    now: Date,
  ): Promise<PendingInvitation[]> {
    const result = await db.query(PENDING_INVITATION_QUERY, [
      user.email,
      now,
      subject,
    ])

    return result.rows.map((value) => {
      const row = rowRecord(value)
      return {
        id: stringField(row, 'id'),
        organisationId: stringField(row, 'organisation_id'),
        hospitalId:
          row.hospital_id === null ? null : stringField(row, 'hospital_id'),
      }
    })
  }

  private async acceptInvitation(
    db: DatabaseQuery,
    user: AppUser,
    invitation: PendingInvitation,
    input: LoginCompletionInput,
  ): Promise<void> {
    let membership: DatabaseResult
    try {
      membership = await db.query(
        `insert into control.membership (user_id, organisation_id, hospital_id)
         values ($1, $2, $3)
         returning id`,
        [user.id, invitation.organisationId, invitation.hospitalId],
      )
    } catch (error) {
      if (isMembershipConflict(error)) {
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

    await new AuditWriter(db).write({
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
    })
  }
}

function isMembershipConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  return code === '23P01' || code === '23505'
}
