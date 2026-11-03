import type { DatabaseQuery } from '../db/pool'
import {
  bufferField,
  dateField,
  integerField,
  nullableBufferField,
  nullableDateField,
  nullableIntegerField,
  nullableStringField,
  rowRecord,
  textArrayField,
  stringField,
} from '../db/rows'

export interface NewWebSession {
  readonly userId: string
  readonly identityIssuer: string
  readonly tokenHash: Buffer
  readonly zitadelSessionId: string | null
  readonly oidcSid: string | null
  readonly acr: string | null
  readonly idTokenHintCiphertext: Buffer | null
  readonly keyVersion: number | null
  readonly amr: readonly string[]
  readonly authTime: Date
  readonly aal: number
  readonly idleExpiresAt: Date
  readonly absoluteExpiresAt: Date
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

export interface WebSession {
  readonly id: string
  readonly userId: string
  readonly identityIssuer: string
  readonly tokenHash: Buffer
  readonly zitadelSessionId: string | null
  readonly oidcSid: string | null
  readonly acr: string | null
  readonly idTokenHintCiphertext: Buffer | null
  readonly keyVersion: number | null
  readonly amr: string[]
  readonly authTime: Date
  readonly aal: number
  readonly createdAt: Date
  readonly lastSeenAt: Date
  readonly idleExpiresAt: Date
  readonly absoluteExpiresAt: Date
  readonly revokedAt: Date | null
  readonly revokeReason: string | null
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

const COLUMNS = `
  id, user_id, identity_issuer, token_hash, zitadel_session_id, oidc_sid, acr,
  id_token_hint_ciphertext, key_version, amr, auth_time, aal, created_at,
  last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason,
  ip, user_agent_hash
`

export class SessionRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async create(input: NewWebSession): Promise<WebSession> {
    const result = await this.db.query(
      `insert into identity.web_session
         (user_id, identity_issuer, token_hash, zitadel_session_id, oidc_sid,
          acr, id_token_hint_ciphertext, key_version, amr, auth_time, aal,
          idle_expires_at, absolute_expires_at, ip, user_agent_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning ${COLUMNS}`,
      [
        input.userId,
        input.identityIssuer,
        input.tokenHash,
        input.zitadelSessionId,
        input.oidcSid,
        input.acr,
        input.idTokenHintCiphertext,
        input.keyVersion,
        [...input.amr],
        input.authTime,
        input.aal,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.ip,
        input.userAgentHash,
      ],
    )

    return mapRow(result.rows[0])
  }

  async findByTokenHash(tokenHash: Buffer): Promise<WebSession | null> {
    const result = await this.db.query(
      `select ${COLUMNS}
         from identity.web_session
        where token_hash = $1`,
      [tokenHash],
    )
    return mapOptionalRow(result.rows[0])
  }

  async findById(id: string): Promise<WebSession | null> {
    const result = await this.db.query(
      `select ${COLUMNS} from identity.web_session where id = $1`,
      [id],
    )
    return mapOptionalRow(result.rows[0])
  }

  /**
   * Extend an active session. The update is conditional, so a concurrent
   * revocation or expiry wins over a stale touch.
   */
  async touch(id: string, at: Date, idleExpiresAt: Date): Promise<boolean> {
    const result = await this.db.query(
      `update identity.web_session
          set last_seen_at = $2, idle_expires_at = $3
        where id = $1
          and revoked_at is null
          and absolute_expires_at > $2
          and idle_expires_at > $2
        returning id`,
      [id, at, idleExpiresAt],
    )
    return result.rows.length === 1
  }

  /** Revoke one session. A second revoke is a no-op, so logout is idempotent. */
  async revoke(id: string, at: Date, reason: string): Promise<boolean> {
    const result = await this.db.query(
      `update identity.web_session
          set revoked_at = $2, revoke_reason = $3
        where id = $1 and revoked_at is null
        returning id`,
      [id, at, reason],
    )
    return result.rows.length === 1
  }

  /** Revoke every live session for a user, for suspension or a forced logout. */
  async revokeAllForUser(userId: string, at: Date, reason: string): Promise<number> {
    const result = await this.db.query(
      `update identity.web_session
          set revoked_at = $2, revoke_reason = $3
        where user_id = $1
          and revoked_at is null
          and absolute_expires_at > $2
        returning id`,
      [userId, at, reason],
    )
    return result.rows.length
  }
}

function mapOptionalRow(row: unknown): WebSession | null {
  return row === undefined ? null : mapRow(row)
}

function mapRow(value: unknown): WebSession {
  if (value === undefined) throw new Error('identity.web_session write returned no row')

  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    userId: stringField(row, 'user_id'),
    identityIssuer: stringField(row, 'identity_issuer'),
    tokenHash: bufferField(row, 'token_hash'),
    zitadelSessionId: nullableStringField(row, 'zitadel_session_id'),
    oidcSid: nullableStringField(row, 'oidc_sid'),
    acr: nullableStringField(row, 'acr'),
    idTokenHintCiphertext: nullableBufferField(row, 'id_token_hint_ciphertext'),
    keyVersion: nullableIntegerField(row, 'key_version'),
    amr: textArray(row),
    authTime: dateField(row, 'auth_time'),
    aal: integerField(row, 'aal'),
    createdAt: dateField(row, 'created_at'),
    lastSeenAt: dateField(row, 'last_seen_at'),
    idleExpiresAt: dateField(row, 'idle_expires_at'),
    absoluteExpiresAt: dateField(row, 'absolute_expires_at'),
    revokedAt: nullableDateField(row, 'revoked_at'),
    revokeReason: nullableStringField(row, 'revoke_reason'),
    ip: nullableStringField(row, 'ip'),
    userAgentHash: nullableBufferField(row, 'user_agent_hash'),
  }
}

function textArray(row: Record<string, unknown>): string[] {
  return textArrayField(row, 'amr')
}