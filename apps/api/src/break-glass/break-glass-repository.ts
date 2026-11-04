import type { DatabaseQuery } from '../db/pool'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'
import {
  dateField,
  hasSqlState,
  isEmpty,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export type BreakGlassApprovalMode = 'pre_approved' | 'emergency'
export type BreakGlassStatus = 'approved' | 'active' | 'revoked' | 'expired'
export type BreakGlassDecision = 'upheld' | 'overturned' | 'escalated'

export interface BreakGlassHospital {
  readonly id: string
  readonly organisationId: string
  readonly name: string
  readonly status: string
}

export interface BreakGlassGrant {
  readonly id: string
  readonly organisationId: string
  readonly hospitalId: string
  readonly userId: string
  readonly approvedBy: string | null
  readonly approvalMode: BreakGlassApprovalMode
  readonly reason: string
  readonly accessLevel: 'read_only'
  readonly status: BreakGlassStatus
  readonly startsAt: Date
  readonly endsAt: Date
  readonly approvedAt: Date
  readonly activatedAt: Date | null
  readonly activatedBy: string | null
  readonly revokedAt: Date | null
  readonly expiredAt: Date | null
  readonly createdAt: Date
}

export interface BreakGlassReview {
  readonly id: string
  readonly grantId: string
  readonly reviewerId: string
  readonly reviewedAt: Date
  readonly decision: BreakGlassDecision
  readonly notes: string | null
}

export interface NewBreakGlassGrant {
  readonly organisationId: string
  readonly hospitalId: string
  readonly userId: string
  readonly approvedBy: string | null
  readonly approvalMode: BreakGlassApprovalMode
  readonly reason: string
  readonly status: 'approved' | 'active'
  readonly startsAt: Date
  readonly endsAt: Date
  readonly activatedAt: Date | null
  readonly activatedBy: string | null
}

const COLUMNS = `
  id, organisation_id, hospital_id, user_id, approved_by, approval_mode, reason,
  access_level, status, lower(validity) as starts_at, upper(validity) as ends_at,
  approved_at, activated_at, activated_by, revoked_at, expired_at, created_at
`

export class BreakGlassConstraintError extends Error {
  constructor() {
    super('break-glass constraint violation')
    this.name = 'BreakGlassConstraintError'
  }
}

/** Control-plane repository for time-boxed emergency access grants. */
export class BreakGlassRepository {
  /** The connection or transaction every method of this instance reads and writes through. */
  constructor(readonly connection: DatabaseQuery) {}

  async findHospital(id: string): Promise<BreakGlassHospital | null> {
    const result = await this.connection.query(
      'select id, organisation_id, name, status from control.hospital where id = $1',
      [id],
    )
    if (isEmpty(result)) return null
    const record = rowRecord(result.rows[0])
    return {
      id: stringField(record, 'id'),
      organisationId: stringField(record, 'organisation_id'),
      name: stringField(record, 'name'),
      status: stringField(record, 'status'),
    }
  }

  async hasActiveMembership(
    userId: string,
    organisationId: string,
    hospitalId: string,
    at: Date,
  ): Promise<boolean> {
    const result = await this.connection.query(
      `select 1
       from control.membership
       where user_id = $1
         and organisation_id = $2
         and status = 'active'
         and validity @> $4::timestamptz
         and (hospital_id is null or hospital_id = $3)
       limit 1`,
      [userId, organisationId, hospitalId, at],
    )

    return result.rows.length > 0
  }

  async findOpenForUserAtHospital(
    userId: string,
    hospitalId: string,
    at: Date,
  ): Promise<BreakGlassGrant | null> {
    const result = await this.connection.query(
      `select ${COLUMNS}
       from control.break_glass_grant
       where user_id = $1
         and hospital_id = $2
         and status in ('approved', 'active')
         and validity @> $3::timestamptz
       limit 1`,
      [userId, hospitalId, at],
    )
    return isEmpty(result) ? null : mapGrant(result.rows[0])
  }

  async create(input: NewBreakGlassGrant): Promise<BreakGlassGrant> {
    const result = await this.connection.query(
      `insert into control.break_glass_grant
         (organisation_id, hospital_id, user_id, approved_by, approval_mode,
          reason, access_level, status, validity, approved_at,
          activated_at, activated_by)
       values ($1, $2, $3, $4, $5, $6, 'read_only', $7,
               tstzrange($8, $9, '[)'), $8, $10, $11)
       returning ${COLUMNS}`,
      [
        input.organisationId,
        input.hospitalId,
        input.userId,
        input.approvedBy,
        input.approvalMode,
        input.reason,
        input.status,
        input.startsAt,
        input.endsAt,
        input.activatedAt,
        input.activatedBy,
      ],
    )

    return mapGrant(single(result.rows[0]))
  }

  async findById(id: string): Promise<BreakGlassGrant | null> {
    const result = await this.connection.query(
      `select ${COLUMNS} from control.break_glass_grant where id = $1`,
      [id],
    )
    return isEmpty(result) ? null : mapGrant(result.rows[0])
  }

  async list(
    userId: string | null,
    hospitalId: string | null,
    page: PageRequest,
  ): Promise<Page<BreakGlassGrant>> {
    const result = await this.connection.query(
      `select ${COLUMNS}
       from control.break_glass_grant
       where ($1::uuid is null or user_id = $1::uuid)
         and ($2::uuid is null or hospital_id = $2::uuid)
       order by created_at desc, id
       limit $3 offset $4`,
      [userId, hospitalId, page.limit + 1, page.offset],
    )

    return pageOf(result.rows.map(mapGrant), page)
  }

  async activate(id: string, userId: string, at: Date): Promise<BreakGlassGrant | null> {
    const result = await this.connection.query(
      `update control.break_glass_grant
       set status = 'active', activated_at = $3, activated_by = $2
       where id = $1
         and user_id = $2
         and status = 'approved'
         and validity @> $3::timestamptz
       returning ${COLUMNS}`,
      [id, userId, at],
    )

    return isEmpty(result) ? null : mapGrant(result.rows[0])
  }

  async revoke(id: string, at: Date): Promise<BreakGlassGrant | null> {
    const result = await this.connection.query(
      `update control.break_glass_grant
       set status = 'revoked', revoked_at = $2
       where id = $1 and status in ('approved', 'active')
       returning ${COLUMNS}`,
      [id, at],
    )

    return isEmpty(result) ? null : mapGrant(result.rows[0])
  }

  async createReview(input: {
    grantId: string
    reviewerId: string
    reviewedAt: Date
    decision: BreakGlassDecision
    notes: string | null
  }): Promise<BreakGlassReview> {
    try {
      const result = await this.connection.query(
        `insert into control.break_glass_review
           (grant_id, reviewer_id, reviewed_at, decision, notes)
         values ($1, $2, $3, $4, $5)
         returning id, grant_id, reviewer_id, reviewed_at, decision, notes`,
        [input.grantId, input.reviewerId, input.reviewedAt, input.decision, input.notes],
      )
      return mapReview(single(result.rows[0]))
    } catch (error) {
      if (isConstraintViolation(error)) throw new BreakGlassConstraintError()
      throw error
    }
  }
}

/** A returning statement always yields its row; anything else is a bug. */
function single(row: unknown): unknown {
  if (row === undefined) throw new Error('database did not return the written row')
  return row
}

/** A constraint or exclusion constraint rejected the write. */
export function isConstraintViolation(error: unknown): boolean {
  return hasSqlState(error, '23505', '23514', '23P01')
}

/** An exclusion constraint rejected an overlapping grant window. */
export function isOverlapViolation(error: unknown): boolean {
  return hasSqlState(error, '23P01')
}

function mapGrant(value: unknown): BreakGlassGrant {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    organisationId: stringField(row, 'organisation_id'),
    hospitalId: stringField(row, 'hospital_id'),
    userId: stringField(row, 'user_id'),
    approvedBy: nullableStringField(row, 'approved_by'),
    approvalMode: stringField(row, 'approval_mode') as BreakGlassApprovalMode,
    reason: stringField(row, 'reason'),
    accessLevel: 'read_only',
    status: stringField(row, 'status') as BreakGlassStatus,
    startsAt: dateField(row, 'starts_at'),
    endsAt: dateField(row, 'ends_at'),
    approvedAt: dateField(row, 'approved_at'),
    activatedAt: nullableDateField(row, 'activated_at'),
    activatedBy: nullableStringField(row, 'activated_by'),
    revokedAt: nullableDateField(row, 'revoked_at'),
    expiredAt: nullableDateField(row, 'expired_at'),
    createdAt: dateField(row, 'created_at'),
  }
}

function mapReview(value: unknown): BreakGlassReview {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    grantId: stringField(row, 'grant_id'),
    reviewerId: stringField(row, 'reviewer_id'),
    reviewedAt: dateField(row, 'reviewed_at'),
    decision: stringField(row, 'decision') as BreakGlassDecision,
    notes: nullableStringField(row, 'notes'),
  }
}
