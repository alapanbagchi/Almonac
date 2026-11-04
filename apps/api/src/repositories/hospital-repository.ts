import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  hasSqlState,
  isEmpty,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'
import { conflict, ruleViolation } from '../shared/errors'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'

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

export interface CreateHospitalInput {
  readonly organisationId: string
  readonly name: string
  readonly slug: string
  readonly timezone: string
}

export interface AddHospitalDomainInput {
  readonly hospitalId: string
  readonly domain: string
  readonly tokenHash: Buffer
}

export interface VerifyHospitalDomainInput {
  readonly hospitalId: string
  readonly domainId: string
  readonly tokenHash: Buffer
  readonly at: Date
}

export interface SetPrimaryDomainInput {
  readonly hospitalId: string
  readonly domainId: string
}

export interface HospitalRepository {
  create(input: CreateHospitalInput): Promise<Hospital>
  findById(id: string): Promise<Hospital | null>
  listByOrganisation(organisationId: string, page: PageRequest): Promise<Page<Hospital>>
  addDomain(input: AddHospitalDomainInput): Promise<HospitalDomain>
  listDomains(hospitalId: string, page: PageRequest): Promise<Page<HospitalDomain>>
  verifyDomain(input: VerifyHospitalDomainInput): Promise<HospitalDomain | null>
  setPrimaryDomain(input: SetPrimaryDomainInput): Promise<Hospital | null>
}

const HOSPITAL_COLUMNS = `
  id, organisation_id, name, slug, timezone, status, primary_domain_id, created_at
`

const DOMAIN_COLUMNS = `
  id, hospital_id, domain::text as domain, verified_at, retired_at, created_at
`

const HOSPITAL_SELECT = `select ${HOSPITAL_COLUMNS} from control.hospital`
const DOMAIN_SELECT = `select ${DOMAIN_COLUMNS} from control.hospital_domain`

/**
 * SQL for hospitals and their domains. A transaction client is passed in by
 * the caller, so every query here runs in the caller's unit of work.
 */
export function createHospitalRepository(db: DatabaseQuery): HospitalRepository {
  return {
    async create(input) {
      try {
        const result = await db.query(
          `insert into control.hospital (organisation_id, name, slug, timezone)
           values ($1, $2, $3, $4)
           returning ${HOSPITAL_COLUMNS}`,
          [input.organisationId, input.name, input.slug, input.timezone],
        )
        return mapHospital(result.rows[0])
      } catch (error) {
        if (hasSqlState(error, '23505')) {
          throw conflict('A hospital with this slug already exists.')
        }
        throw error
      }
    },

    async findById(id) {
      const result = await db.query(`${HOSPITAL_SELECT} where id = $1`, [id])
      return isEmpty(result) ? null : mapHospital(result.rows[0])
    },

    async listByOrganisation(organisationId, page) {
      const result = await db.query(
        `${HOSPITAL_SELECT} where organisation_id = $1 order by name, id
         limit $2 offset $3`,
        [organisationId, page.limit + 1, page.offset],
      )
      return pageOf(result.rows.map(mapHospital), page)
    },

    async addDomain(input) {
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
        if (hasSqlState(error, '23505')) throw conflict('This domain is already registered.')
        throw error
      }
    },

    async listDomains(hospitalId, page) {
      const result = await db.query(
        `${DOMAIN_SELECT} where hospital_id = $1 order by created_at, id
         limit $2 offset $3`,
        [hospitalId, page.limit + 1, page.offset],
      )
      return pageOf(result.rows.map(mapDomain), page)
    },

    async verifyDomain(input) {
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
    },

    async setPrimaryDomain(input) {
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
          throw ruleViolation(
            'The domain must be verified for this hospital before it becomes primary.',
          )
        }
        throw error
      }
    },
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
