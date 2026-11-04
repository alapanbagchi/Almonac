import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  isEmpty,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export interface PendingRegistration {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly passwordHash: string
  readonly expiresAt: Date
  readonly claimedAt: Date | null
  readonly claimId: string | null
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

export type ClaimedPendingRegistration = PendingRegistration & {
  readonly claimedAt: Date
  readonly claimId: string
}

export interface PendingRegistrationStore {
  replace(input: NewPendingRegistration): Promise<void>
  claim(
    db: DatabaseQuery,
    tokenHash: Buffer,
    leaseSeconds: number,
  ): Promise<ClaimedPendingRegistration | null>
  release(db: DatabaseQuery, id: string, claimId: string): Promise<boolean>
  finish(db: DatabaseQuery, id: string, claimId: string): Promise<boolean>
}

const COLUMNS = `
  id, email, display_name, password_hash, expires_at,
  claimed_at, claim_id, consumed_at
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
       on conflict (email) where consumed_at is null and claimed_at is null do update set
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
   * Reserve an open row without holding a transaction across the provider call.
   * A claim older than the lease may be taken over, so a crashed attempt cannot
   * strand the link forever. Database time is authoritative for both the expiry
   * check and the claim, so a skewed application clock cannot break the
   * `claimed_at` constraint.
   */
  async claim(
    db: DatabaseQuery,
    tokenHash: Buffer,
    leaseSeconds: number,
  ): Promise<ClaimedPendingRegistration | null> {
    const result = await db.query(
      `update identity.pending_registration
          set claimed_at = now(), claim_id = gen_random_uuid()
        where token_hash = $1
          and consumed_at is null
          and expires_at > now()
          and (claimed_at is null or claimed_at <= now() - $2 * interval '1 second')
        returning ${COLUMNS}`,
      [tokenHash, leaseSeconds],
    )
    if (isEmpty(result)) return null
    const registration = mapRow(result.rows[0])
    if (registration.claimedAt === null || registration.claimId === null) {
      throw new Error('claimed registration has no claim identifier')
    }
    return {
      ...registration,
      claimedAt: registration.claimedAt,
      claimId: registration.claimId,
    }
  }

  async release(db: DatabaseQuery, id: string, claimId: string): Promise<boolean> {
    const result = await db.query(
      `update identity.pending_registration
          set claimed_at = null, claim_id = null
        where id = $1 and claim_id = $2 and consumed_at is null
        returning id`,
      [id, claimId],
    )
    return result.rows.length === 1
  }

  async finish(db: DatabaseQuery, id: string, claimId: string): Promise<boolean> {
    const result = await db.query(
      `update identity.pending_registration
          set consumed_at = now()
        where id = $1 and claim_id = $2 and consumed_at is null
        returning id`,
      [id, claimId],
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
    claimedAt: nullableDateField(row, 'claimed_at'),
    claimId: nullableStringField(row, 'claim_id'),
    consumedAt: nullableDateField(row, 'consumed_at'),
  }
}
