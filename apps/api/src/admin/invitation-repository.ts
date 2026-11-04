import type { Pool } from 'pg'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import {
  dateField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
  textArrayField,
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

const SELECT_COLUMNS = `${COLUMNS},
  coalesce(
    (select array_agg(invitation_role.role_id::text order by invitation_role.role_id)
       from control.invitation_role as invitation_role
      where invitation_role.invitation_id = invitation.id),
    '{}'::text[]
  ) as role_ids
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
  }, db?: DatabaseQuery): Promise<Invitation> {
    if (db === undefined) {
      return withTransaction(this.pool, (tx) => this.create(input, tx))
    }
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
      `select ${SELECT_COLUMNS} from identity.invitation as invitation where invitation.id = $1`,
      [id],
    )
    return result.rows[0] === undefined ? null : mapRow(result.rows[0])
  }

  async list(
    input: { organisationId: string; hospitalId?: string | null },
    page: PageRequest,
  ): Promise<Page<Invitation>> {
    const result = await this.pool.query(
      `select ${SELECT_COLUMNS}
         from identity.invitation as invitation
        where invitation.organisation_id = $1
          and ($2::uuid is null or invitation.hospital_id = $2)
        order by invitation.created_at desc, invitation.id
        limit $3 offset $4`,
      [input.organisationId, input.hospitalId ?? null, page.limit + 1, page.offset],
    )
    return pageOf(result.rows.map(mapRow), page)
  }

  async findPendingForScope(input: {
    email: string
    organisationId: string
    hospitalId: string | null
  }): Promise<Invitation | null> {
    const result = await this.pool.query(
      `select ${SELECT_COLUMNS}
         from identity.invitation as invitation
        where invitation.email = $1
          and invitation.organisation_id = $2
          and invitation.hospital_id is not distinct from $3::uuid
          and invitation.status = 'pending'
          and invitation.expires_at > now()
        order by invitation.created_at desc
        limit 1`,
      [input.email, input.organisationId, input.hospitalId],
    )
    return result.rows[0] === undefined ? null : mapRow(result.rows[0])
  }

  async revokePending(
    id: string,
    at: Date,
    db: DatabaseQuery = this.pool,
  ): Promise<boolean> {
    const result = await db.query(
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
    `select ${SELECT_COLUMNS}
       from identity.invitation as invitation
      where invitation.token_hash = $1
      for update`,
    [tokenHash],
  )
  return result.rows[0] === undefined ? null : mapRow(result.rows[0])
}

function mapRow(value: unknown): Invitation {
  const row = rowRecord(value)
  return mapInvitation(row, textArrayField(row, 'role_ids'))
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
