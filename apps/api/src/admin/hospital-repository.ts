import type { DatabaseQuery } from '../db/pool'
import { ConflictError, RuleViolation } from '../shared/errors'
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

export type HospitalStatus = 'pending' | 'active' | 'suspended' | 'closed'

export interface Hospital {
  readonly id: string
  readonly organisationId: string
  readonly name: string
  readonly slug: string
  readonly timezone: string
  readonly status: HospitalStatus
  readonly primaryDomainId: string | null
  readonly createdAt: Date
}

export interface HospitalDomain {
  readonly id: string
  readonly hospitalId: string
  readonly domain: string
  readonly verifiedAt: Date | null
  readonly retiredAt: Date | null
  readonly createdAt: Date
}

const HOSPITAL_COLUMNS = `
  id, organisation_id, name, slug, timezone, status, primary_domain_id, created_at
`

const DOMAIN_COLUMNS = `
  id, hospital_id, domain::text as domain, verified_at, retired_at, created_at
`

const HOSPITAL_SELECT = `select ${HOSPITAL_COLUMNS} from control.hospital`
const DOMAIN_SELECT = `select ${DOMAIN_COLUMNS} from control.hospital_domain`

export class HospitalRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async create(
    input: { organisationId: string; name: string; slug: string; timezone: string },
    db: DatabaseQuery = this.db,
  ): Promise<Hospital> {
    try {
      const result = await db.query(
        `insert into control.hospital (organisation_id, name, slug, timezone)
         values ($1, $2, $3, $4)
         returning ${HOSPITAL_COLUMNS}`,
        [input.organisationId, input.name, input.slug, input.timezone],
      )
      return mapHospital(result.rows[0])
    } catch (error) {
      if (hasSqlState(error, '23505')) throw new ConflictError('A hospital with this slug already exists.')
      throw error
    }
  }

  async findById(id: string): Promise<Hospital | null> {
    const result = await this.db.query(`${HOSPITAL_SELECT} where id = $1`, [id])
    return isEmpty(result) ? null : mapHospital(result.rows[0])
  }

  async listByOrganisation(
    organisationId: string,
    page: PageRequest,
  ): Promise<Page<Hospital>> {
    const result = await this.db.query(
      `${HOSPITAL_SELECT} where organisation_id = $1 order by name, id
       limit $2 offset $3`,
      [organisationId, page.limit + 1, page.offset],
    )
    return pageOf(result.rows.map(mapHospital), page)
  }

  async addDomain(
    input: { hospitalId: string; domain: string; tokenHash: Buffer },
    db: DatabaseQuery = this.db,
  ): Promise<HospitalDomain> {
    try {
      const result = await db.query(
        `insert into control.hospital_domain
           (hospital_id, domain, verification_token_hash)
         values ($1, $2, $3)
         returning ${DOMAIN_COLUMNS}`,
        [input.hospitalId, input.domain, input.tokenHash],
      )
      return mapDomain(result.rows[0])
    } catch (error) {
      if (hasSqlState(error, '23505')) throw new ConflictError('This domain is already registered.')
      throw error
    }
  }

  async listDomains(hospitalId: string, page: PageRequest): Promise<Page<HospitalDomain>> {
    const result = await this.db.query(
      `${DOMAIN_SELECT} where hospital_id = $1 order by created_at, id
       limit $2 offset $3`,
      [hospitalId, page.limit + 1, page.offset],
    )
    return pageOf(result.rows.map(mapDomain), page)
  }

  async verifyDomain(
    input: { hospitalId: string; domainId: string; tokenHash: Buffer; at: Date },
    db: DatabaseQuery = this.db,
  ): Promise<HospitalDomain | null> {
    const result = await db.query(
      `update control.hospital_domain
          set verified_at = $4, verification_token_hash = null
        where id = $2
          and hospital_id = $1
          and verification_token_hash = $3
          and verified_at is null
          and retired_at is null
        returning ${DOMAIN_COLUMNS}`,
      [input.hospitalId, input.domainId, input.tokenHash, input.at],
    )
    return isEmpty(result) ? null : mapDomain(result.rows[0])
  }

  async setPrimaryDomain(
    input: { hospitalId: string; domainId: string; at: Date },
    db: DatabaseQuery = this.db,
  ): Promise<Hospital | null> {
    try {
      const result = await db.query(
        `update control.hospital
            set primary_domain_id = $2, status = 'active'
          where id = $1
          returning ${HOSPITAL_COLUMNS}`,
        [input.hospitalId, input.domainId],
      )
      return isEmpty(result) ? null : mapHospital(result.rows[0])
    } catch (error) {
      // The trigger rejects a missing, unverified, retired or foreign domain
      // with 23503 or 23514. Both mean the same thing to the caller.
      if (hasSqlState(error, '23503', '23514')) {
        throw new RuleViolation('The domain must be verified for this hospital before it becomes primary.')
      }
      throw error
    }
  }
}

function mapHospital(value: unknown): Hospital {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    organisationId: stringField(row, 'organisation_id'),
    name: stringField(row, 'name'),
    slug: stringField(row, 'slug'),
    timezone: stringField(row, 'timezone'),
    status: stringField(row, 'status') as HospitalStatus,
    primaryDomainId: nullableStringField(row, 'primary_domain_id'),
    createdAt: dateField(row, 'created_at'),
  }
}

function mapDomain(value: unknown): HospitalDomain {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    hospitalId: stringField(row, 'hospital_id'),
    domain: stringField(row, 'domain'),
    verifiedAt: nullableDateField(row, 'verified_at'),
    retiredAt: nullableDateField(row, 'retired_at'),
    createdAt: dateField(row, 'created_at'),
  }
}
