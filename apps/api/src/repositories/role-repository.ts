import type { DatabaseQuery } from '../db/pool'
import { hasSqlState, isEmpty, rowRecord, stringField, textArrayField } from '../db/rows'
import { conflict } from '../shared/errors'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'

export interface OrganisationRole {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly scope: 'organisation' | 'hospital'
  readonly permissions: readonly string[]
}

export interface AssignRoleInput {
  readonly membershipId: string
  readonly roleId: string
  readonly assignedBy: string
  readonly at: Date
}

export interface RevokeRoleInput {
  readonly membershipId: string
  readonly roleId: string
  readonly revokedBy: string
  readonly at: Date
  readonly reason: string
}

export interface RoleRepository {
  list(organisationId: string, page: PageRequest): Promise<Page<OrganisationRole>>
  find(organisationId: string, roleId: string): Promise<OrganisationRole | null>
  findAll(organisationId: string, roleIds: readonly string[]): Promise<OrganisationRole[]>
  assign(input: AssignRoleInput): Promise<void>
  revoke(input: RevokeRoleInput): Promise<boolean>
}

const ROLE_SELECT = `
  select role.id, role.key, role.name, role.scope,
         coalesce(
           array_agg(role_permission.permission_key order by role_permission.permission_key)
             filter (where role_permission.permission_key is not null),
           '{}'::text[]
         ) as permissions
    from control.role as role
    left join control.role_permission as role_permission
      on role_permission.role_id = role.id
`

const ROLE_GROUP = ' group by role.id, role.key, role.name, role.scope'

/** SQL for the role aggregate, including the membership_role join rows. */
export function createRoleRepository(db: DatabaseQuery): RoleRepository {
  return {
    async list(organisationId, page) {
      const result = await db.query(
        `${ROLE_SELECT}
          where role.organisation_id = $1
          ${ROLE_GROUP}
          order by role.scope, role.key
          limit $2 offset $3`,
        [organisationId, page.limit + 1, page.offset],
      )
      return pageOf(result.rows.map(mapRole), page)
    },

    async find(organisationId, roleId) {
      const result = await db.query(
        `${ROLE_SELECT}
          where role.organisation_id = $1 and role.id = $2
          ${ROLE_GROUP}`,
        [organisationId, roleId],
      )
      return isEmpty(result) ? null : mapRole(result.rows[0])
    },

    async findAll(organisationId, roleIds) {
      const result = await db.query(
        `${ROLE_SELECT}
          where role.organisation_id = $1 and role.id = any($2::uuid[])
          ${ROLE_GROUP}`,
        [organisationId, roleIds],
      )
      return result.rows.map(mapRole)
    },

    async assign(input) {
      try {
        await db.query(
          `insert into control.membership_role
             (membership_id, role_id, assigned_by, assigned_at, validity)
           values ($1, $2, $3, $4, tstzrange($4, null, '[)'))`,
          [input.membershipId, input.roleId, input.assignedBy, input.at],
        )
      } catch (error) {
        // The exclusion constraint and the unique index both mean the same thing.
        if (hasSqlState(error, '23P01', '23505')) {
          throw conflict('This role is already assigned to the membership.')
        }
        throw error
      }
    },

    async revoke(input) {
      const result = await db.query(
        `update control.membership_role
            set revoked_at = $3, revoked_by = $4, revoke_reason = $5,
                validity = tstzrange(lower(validity), $3, '[)')
          where membership_id = $1
            and role_id = $2
            and revoked_at is null
            and validity @> $3::timestamptz
          returning id`,
        [input.membershipId, input.roleId, input.revokedBy, input.at, input.reason],
      )
      return result.rows.length > 0
    },
  }
}

function mapRole(value: unknown): OrganisationRole {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    key: stringField(row, 'key'),
    name: stringField(row, 'name'),
    scope: stringField(row, 'scope') as OrganisationRole['scope'],
    permissions: textArrayField(row, 'permissions'),
  }
}
