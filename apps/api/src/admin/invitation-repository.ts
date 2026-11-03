import type { Pool } from 'pg'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export type InvitationKind = 'new_user' | 'existing_user'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Invitation {
  readonly id: string
  readonly email: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly kind: InvitationKind
  readonly zitadelSub: string | null
  readonly status: InvitationStatus
  readonly expiresAt: Date
  readonly createdAt: Date
  readonly acceptedAt: Date | null
  readonly acceptedByUserId: string | null
  readonly invitedBy: string
  readonly roleIds: readonly string[]
}

const COLUMNS = `
  id, email::text as email, organisation_id, hospital_id, kind, zitadel_sub, status,
  expires_at, created_at, accepted_at, accepted_by_user_id, invited_by
`

export class InvitationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    email: string
    organisationId: string
    hospitalId: string | null
    kind: InvitationKind
    zitadelSub: string | null
    tokenHash: Buffer
    invitedBy: string
    expiresAt: Date
    roleIds: readonly string[]
  }): Promise<Invitation> {
    return withTransaction(this.pool, async (db) => {
      const result = await db.query(
        `insert into identity.invitation
           (email, organisation_id, hospital_id, kind, zitadel_sub, token_hash,
            invited_by, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning ${COLUMNS}`,
        [
          input.email,
          input.organisationId,
          input.hospitalId,
          input.kind,
          input.zitadelSub,
          input.tokenHash,
          input.invitedBy,
          input.expiresAt,
        ],
      )
      const invitation = mapInvitation(result.rows[0], [])
      for (const roleId of input.roleIds) {
        await db.query(
          `insert into control.invitation_role (invitation_id, role_id, assigned_by)
           values ($1, $2, $3)`,
          [invitation.id, roleId, input.invitedBy],
        )
      }
      return { ...invitation, roleIds: [...input.roleIds] }
    })
  }

  async findByTokenHash(tokenHash: Buffer): Promise<Invitation | null> {
    return withTransaction(this.pool, (db) => this.findByTokenHashForUpdate(db, tokenHash))
  }

  async findByTokenHashForUpdate(
    db: DatabaseQuery,
    tokenHash: Buffer,
  ): Promise<Invitation | null> {
    return findInvitationByTokenHashForUpdate(db, tokenHash)
  }

  async findById(id: string): Promise<Invitation | null> {
    const result = await this.pool.query(
      `select ${COLUMNS} from identity.invitation where id = $1`,
      [id],
    )
    if (result.rows[0] === undefined) return null
    return withRoles(this.pool, result.rows[0])
  }

  async list(input: {
    organisationId: string
    hospitalId?: string | null
  }): Promise<Invitation[]> {
    const result = await this.pool.query(
      `select ${COLUMNS}
         from identity.invitation
        where organisation_id = $1
          and ($2::uuid is null or hospital_id = $2)
        order by created_at desc, id`,
      [input.organisationId, input.hospitalId ?? null],
    )
    return Promise.all(
      result.rows.map(async (row) => withRoles(this.pool, row)),
    )
  }

  async findPendingForScope(input: {
    email: string
    organisationId: string
    hospitalId: string | null
  }): Promise<Invitation | null> {
    const result = await this.pool.query(
      `select ${COLUMNS}
         from identity.invitation
        where email = $1
          and organisation_id = $2
          and hospital_id is not distinct from $3::uuid
          and status = 'pending'
          and expires_at > now()
        order by created_at desc
        limit 1`,
      [input.email, input.organisationId, input.hospitalId],
    )
    if (result.rows[0] === undefined) return null
    return withRoles(this.pool, result.rows[0])
  }

  async revokePending(id: string, at: Date): Promise<boolean> {
    const result = await this.pool.query(
      `update identity.invitation
          set status = 'revoked', revoked_at = $2
        where id = $1 and status = 'pending' and expires_at > $2
        returning id`,
      [id, at],
    )
    return result.rows.length > 0
  }

  async revokePendingForScope(input: {
    email: string
    organisationId: string
    hospitalId: string | null
    at: Date
  }): Promise<number> {
    const result = await this.pool.query(
      `update identity.invitation
          set status = 'revoked', revoked_at = $4
        where email = $1
          and organisation_id = $2
          and hospital_id is not distinct from $3::uuid
          and status = 'pending'
          and expires_at > $4
        returning id`,
      [input.email, input.organisationId, input.hospitalId, input.at],
    )
    return result.rows.length
  }

  async markAccepted(input: {
    id: string
    acceptedByUserId: string
    at: Date
  }): Promise<boolean> {
    return this.markAcceptedWith(this.pool, input)
  }

  async markAcceptedWith(
    db: DatabaseQuery,
    input: { id: string; acceptedByUserId: string; at: Date },
  ): Promise<boolean> {
    const result = await db.query(
      `update identity.invitation
          set status = 'accepted',
              accepted_at = $3,
              accepted_by_user_id = $2
        where id = $1
          and status = 'pending'
          and expires_at > $3
        returning id`,
      [input.id, input.acceptedByUserId, input.at],
    )
    return result.rows.length > 0
  }
}

export async function findInvitationByTokenHashForUpdate(
  db: DatabaseQuery,
  tokenHash: Buffer,
): Promise<Invitation | null> {
  const result = await db.query(
    `select ${COLUMNS}
       from identity.invitation
      where token_hash = $1
      for update`,
    [tokenHash],
  )
  if (result.rows[0] === undefined) return null
  return withRoles(db, result.rows[0])
}

async function withRoles(db: DatabaseQuery, row: unknown): Promise<Invitation> {
  const roles = await db.query(
    `select role_id from control.invitation_role where invitation_id = $1`,
    [rowRecord(row).id],
  )
  return mapInvitation(
    row,
    roles.rows.map((role) => stringField(rowRecord(role), 'role_id')),
  )
}

function mapInvitation(value: unknown, roleIds: readonly string[]): Invitation {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    email: stringField(row, 'email'),
    organisationId: stringField(row, 'organisation_id'),
    hospitalId: nullableStringField(row, 'hospital_id'),
    kind: stringField(row, 'kind') as InvitationKind,
    zitadelSub: nullableStringField(row, 'zitadel_sub'),
    status: stringField(row, 'status') as InvitationStatus,
    expiresAt: dateField(row, 'expires_at'),
    createdAt: dateField(row, 'created_at'),
    acceptedAt: nullableDateField(row, 'accepted_at'),
    acceptedByUserId: nullableStringField(row, 'accepted_by_user_id'),
    invitedBy: stringField(row, 'invited_by'),
    roleIds,
  }
}
