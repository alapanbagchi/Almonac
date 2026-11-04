import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableDateField,
  rowRecord,
  stringField,
} from '../db/rows'

export interface PendingRegistration {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly passwordHash: string
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

export interface NewPendingRegistration {
  readonly email: string
  readonly displayName: string
  readonly passwordHash: string
  readonly tokenHash: Buffer
  readonly expiresAt: Date
  readonly requestedIp: string | null
  readonly userAgentHash: Buffer | null
}

export interface PendingRegistrationStore {
  replace(input: NewPendingRegistration): Promise<void>
  findForUpdate(
    db: DatabaseQuery,
    tokenHash: Buffer,
    at: Date,
  ): Promise<PendingRegistration | null>
  markConsumed(db: DatabaseQuery, id: string, at: Date): Promise<boolean>
}

const COLUMNS = `
  id, email, display_name, password_hash, expires_at, consumed_at
`

/**
 * Sign-ups that wait for email verification. A second request for the same
 * address replaces the first, so a lost message cannot lock the address. The
 * partial unique index makes that replacement a single atomic upsert.
 */
export class PendingRegistrationRepository implements PendingRegistrationStore {
  constructor(private readonly db: DatabaseQuery) {}

  async replace(input: NewPendingRegistration): Promise<void> {
    await this.db.query(
      `insert into identity.pending_registration
         (email, display_name, password_hash, token_hash, expires_at,
          requested_ip, user_agent_hash)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (email) where consumed_at is null do update set
         display_name = excluded.display_name,
         password_hash = excluded.password_hash,
         token_hash = excluded.token_hash,
         created_at = now(),
         expires_at = excluded.expires_at,
         requested_ip = excluded.requested_ip,
         user_agent_hash = excluded.user_agent_hash`,
      [
        input.email,
        input.displayName,
        input.passwordHash,
        input.tokenHash,
        input.expiresAt,
        input.requestedIp,
        input.userAgentHash,
      ],
    )
  }

  /**
   * Lock the open row for the duration of the verification transaction. The
   * lock is what stops two concurrent clicks from creating two identities.
   */
  async findForUpdate(
    db: DatabaseQuery,
    tokenHash: Buffer,
    at: Date,
  ): Promise<PendingRegistration | null> {
    const result = await db.query(
      `select ${COLUMNS}
         from identity.pending_registration
        where token_hash = $1 and consumed_at is null and expires_at > $2
        for update`,
      [tokenHash, at],
    )
    return result.rows[0] === undefined ? null : mapRow(result.rows[0])
  }

  async markConsumed(db: DatabaseQuery, id: string, at: Date): Promise<boolean> {
    const result = await db.query(
      `update identity.pending_registration
          set consumed_at = $2
        where id = $1 and consumed_at is null
        returning id`,
      [id, at],
    )
    return result.rows.length === 1
  }
}

function mapRow(value: unknown): PendingRegistration {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    email: stringField(row, 'email'),
    displayName: stringField(row, 'display_name'),
    passwordHash: stringField(row, 'password_hash'),
    expiresAt: dateField(row, 'expires_at'),
    consumedAt: nullableDateField(row, 'consumed_at'),
  }
}
