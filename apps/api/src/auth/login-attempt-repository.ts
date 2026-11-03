import type { DatabaseQuery } from '../db/pool'
import {
  bufferField,
  dateField,
  integerField,
  nullableBufferField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export type LoginPurpose = 'login' | 'step_up'

export interface NewLoginAttempt {
  readonly userId: string | null
  readonly stateHash: Buffer
  readonly nonceHash: Buffer
  readonly pkceVerifierCiphertext: Buffer
  readonly keyVersion: number
  readonly returnTo: string
  readonly purpose: LoginPurpose
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly expiresAt: Date
}

export interface LoginAttempt {
  readonly id: string
  readonly userId: string | null
  readonly stateHash: Buffer
  readonly nonceHash: Buffer
  readonly pkceVerifierCiphertext: Buffer
  readonly keyVersion: number
  readonly returnTo: string
  readonly purpose: LoginPurpose
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

const COLUMNS = `
  id, user_id, state_hash, nonce_hash, pkce_verifier_ciphertext, key_version,
  return_to, purpose, ip, user_agent_hash, created_at, expires_at, consumed_at
`

export interface LoginAttemptStore {
  create(input: NewLoginAttempt): Promise<LoginAttempt>
  consume(stateHash: Buffer, at: Date): Promise<LoginAttempt | null>
}

export class LoginAttemptRepository implements LoginAttemptStore {
  constructor(private readonly db: DatabaseQuery) {}

  async create(input: NewLoginAttempt): Promise<LoginAttempt> {
    const result = await this.db.query(
      `insert into identity.login_attempt
         (user_id, state_hash, nonce_hash, pkce_verifier_ciphertext, key_version,
          return_to, purpose, ip, user_agent_hash, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning ${COLUMNS}`,
      [
        input.userId,
        input.stateHash,
        input.nonceHash,
        input.pkceVerifierCiphertext,
        input.keyVersion,
        input.returnTo,
        input.purpose,
        input.ip,
        input.userAgentHash,
        input.expiresAt,
      ],
    )

    return mapRow(result.rows[0])
  }

  /**
   * Consume an attempt exactly once. The conditional update is the replay
   * defence: a second callback for the same state gets no row.
   */
  async consume(stateHash: Buffer, at: Date): Promise<LoginAttempt | null> {
    const result = await this.db.query(
      `update identity.login_attempt
          set consumed_at = $2
        where state_hash = $1
          and consumed_at is null
          and expires_at > $2
        returning ${COLUMNS}`,
      [stateHash, at],
    )

    return result.rows[0] === undefined ? null : mapRow(result.rows[0])
  }
}

function mapRow(value: unknown): LoginAttempt {
  if (value === undefined) throw new Error('identity.login_attempt write returned no row')

  const row = rowRecord(value)
  const purpose = stringField(row, 'purpose')
  if (purpose !== 'login' && purpose !== 'step_up') {
    throw new Error('database field purpose is not a known login purpose')
  }

  return {
    id: stringField(row, 'id'),
    userId: nullableStringField(row, 'user_id'),
    stateHash: bufferField(row, 'state_hash'),
    nonceHash: bufferField(row, 'nonce_hash'),
    pkceVerifierCiphertext: bufferField(row, 'pkce_verifier_ciphertext'),
    keyVersion: integerField(row, 'key_version'),
    returnTo: stringField(row, 'return_to'),
    purpose,
    ip: nullableStringField(row, 'ip'),
    userAgentHash: nullableBufferField(row, 'user_agent_hash'),
    createdAt: dateField(row, 'created_at'),
    expiresAt: dateField(row, 'expires_at'),
    consumedAt: nullableDateField(row, 'consumed_at'),
  }
}
