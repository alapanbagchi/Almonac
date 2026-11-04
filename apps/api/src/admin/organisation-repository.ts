import type { DatabaseQuery } from '../db/pool'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'
import {
  dateField,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export type OrganisationStatus = 'pending' | 'active' | 'suspended' | 'archived'

export interface Organisation {
  readonly id: string
  readonly zitadelOrgId: string | null
  readonly name: string
  readonly slug: string
  readonly status: OrganisationStatus
  readonly provisionedAt: Date | null
  readonly createdAt: Date
}

export class OrganisationSlugConflictError extends Error {
  constructor() {
    super('organisation slug already exists')
    this.name = 'OrganisationSlugConflictError'
  }
}

const SELECT = `
  select id, zitadel_org_id, name, slug, status, provisioned_at, created_at
  from control.organisation
`

/**
 * Organisation persistence. Provisioning policy, audit and Zitadel calls live
 * in the service, not here.
 */
export class OrganisationRepository {
  constructor(private readonly db: DatabaseQuery) {}

  async createPending(name: string, slug: string): Promise<Organisation> {
    try {
      const result = await this.db.query(
        `insert into control.organisation (name, slug)
         values ($1, $2)
         returning id, zitadel_org_id, name, slug, status, provisioned_at, created_at`,
        [name, slug],
      )
      return mapOrganisation(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) throw new OrganisationSlugConflictError()
      throw error
    }
  }

  async findById(id: string): Promise<Organisation | null> {
    const result = await this.db.query(`${SELECT} where id = $1`, [id])
    return result.rows[0] === undefined ? null : mapOrganisation(result.rows[0])
  }

  async findBySlug(slug: string): Promise<Organisation | null> {
    const result = await this.db.query(`${SELECT} where slug = $1`, [slug])
    return result.rows[0] === undefined ? null : mapOrganisation(result.rows[0])
  }

  async listAll(page: PageRequest): Promise<Page<Organisation>> {
    const result = await this.db.query(
      `${SELECT} order by name, id limit $1 offset $2`,
      [page.limit + 1, page.offset],
    )
    return pageOf(result.rows.map(mapOrganisation), page)
  }

  async listForUser(userId: string, page: PageRequest): Promise<Page<Organisation>> {
    const result = await this.db.query(
      `${SELECT}
       where id in (
         select organisation_id from control.membership
         where user_id = $1 and status = 'active' and validity @> now()
       )
       order by name, id
       limit $2 offset $3`,
      [userId, page.limit + 1, page.offset],
    )
    return pageOf(result.rows.map(mapOrganisation), page)
  }

  async markProvisioned(id: string, zitadelOrgId: string, at: Date): Promise<Organisation> {
    const result = await this.db.query(
      `update control.organisation
          set zitadel_org_id = $2, provisioned_at = $3, status = 'active'
        where id = $1
        returning id, zitadel_org_id, name, slug, status, provisioned_at, created_at`,
      [id, zitadelOrgId, at],
    )
    if (result.rows[0] === undefined) throw new Error('organisation not found')
    return mapOrganisation(result.rows[0])
  }
}

function mapOrganisation(value: unknown): Organisation {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    zitadelOrgId: nullableStringField(row, 'zitadel_org_id'),
    name: stringField(row, 'name'),
    slug: stringField(row, 'slug'),
    status: stringField(row, 'status') as OrganisationStatus,
    provisionedAt: nullableDateField(row, 'provisioned_at'),
    createdAt: dateField(row, 'created_at'),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
