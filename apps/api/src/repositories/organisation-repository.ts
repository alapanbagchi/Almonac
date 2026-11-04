import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  hasSqlState,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'
import type { PageRequest } from '../shared/pagination'
import { conflict } from '../shared/errors'

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

export interface OrganisationRepository {
  createPending(name: string, slug: string): Promise<Organisation>
  findById(id: string): Promise<Organisation | null>
  findBySlug(slug: string): Promise<Organisation | null>
  listAll(page: PageRequest): Promise<Organisation[]>
  listForUser(userId: string, page: PageRequest): Promise<Organisation[]>
  markProvisioned(id: string, zitadelOrgId: string, at: Date): Promise<Organisation>
  /** Serialise provisioning of one slug for the rest of the transaction. */
  lockSlug(slug: string): Promise<void>
  instantiateRoleTemplates(organisationId: string, templates: readonly string[]): Promise<void>
}

const COLUMNS = 'id, zitadel_org_id, name, slug, status, provisioned_at, created_at'

/** Persistence for control.organisation: SQL and row mapping, no policy. */
export function createOrganisationRepository(db: DatabaseQuery): OrganisationRepository {
  return {
    async createPending(name, slug) {
      try {
        const result = await db.query(
          `insert into control.organisation (name, slug) values ($1, $2) returning ${COLUMNS}`,
          [name, slug],
        )
        return mapOrganisation(result.rows[0])
      } catch (error) {
        if (hasSqlState(error, '23505')) {
          throw conflict('An organisation with this slug already exists.')
        }
        throw error
      }
    },

    async findById(id) {
      const result = await db.query(
        `select ${COLUMNS} from control.organisation where id = $1`,
        [id],
      )
      return optionalOrganisation(result.rows[0])
    },

    async findBySlug(slug) {
      const result = await db.query(
        `select ${COLUMNS} from control.organisation where slug = $1`,
        [slug],
      )
      return optionalOrganisation(result.rows[0])
    },

    async listAll(page) {
      const result = await db.query(
        `select ${COLUMNS} from control.organisation order by name, id limit $1 offset $2`,
        [page.limit + 1, page.offset],
      )
      return result.rows.map(mapOrganisation)
    },

    async listForUser(userId, page) {
      const result = await db.query(
        `select ${COLUMNS}
           from control.organisation
          where id in (
            select organisation_id
              from control.membership
             where user_id = $1
               and status = 'active'
               and validity @> now()
          )
          order by name, id
          limit $2 offset $3`,
        [userId, page.limit + 1, page.offset],
      )
      return result.rows.map(mapOrganisation)
    },

    async markProvisioned(id, zitadelOrgId, at) {
      const result = await db.query(
        `update control.organisation
            set zitadel_org_id = $2, provisioned_at = $3, status = 'active'
          where id = $1
          returning ${COLUMNS}`,
        [id, zitadelOrgId, at],
      )
      return mapOrganisation(result.rows[0])
    },

    async lockSlug(slug) {
      await db.query('select pg_advisory_xact_lock(hashtext($1))', [slug])
    },

    async instantiateRoleTemplates(organisationId, templates) {
      for (const template of templates) {
        await db.query('select control.instantiate_role_template($1, $2)', [
          organisationId,
          template,
        ])
      }
    },
  }
}

function optionalOrganisation(row: unknown): Organisation | null {
  return row === undefined ? null : mapOrganisation(row)
}

function mapOrganisation(value: unknown): Organisation {
  if (value === undefined) throw new Error('control.organisation write returned no row')

  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    zitadelOrgId: nullableStringField(row, 'zitadel_org_id'),
    name: stringField(row, 'name'),
    slug: stringField(row, 'slug'),
    status: organisationStatus(stringField(row, 'status')),
    provisionedAt: nullableDateField(row, 'provisioned_at'),
    createdAt: dateField(row, 'created_at'),
  }
}

function organisationStatus(value: string): OrganisationStatus {
  if (value === 'pending' || value === 'active' || value === 'suspended' || value === 'archived') {
    return value
  }
  throw new Error('database field status is not a known organisation status')
}
