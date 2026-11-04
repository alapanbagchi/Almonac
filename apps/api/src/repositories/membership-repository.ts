import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  integerField,
  isEmpty,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
  textArrayField,
} from '../db/rows'
import { pageOf, type Page, type PageRequest } from '../shared/pagination'

export type MembershipStatus = 'active' | 'suspended' | 'revoked' | 'expired'

export interface MembershipSummary {
  readonly id: string
  readonly userId: string
  readonly email: string
  readonly displayName: string
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly status: MembershipStatus
  readonly acceptedAt: Date
  readonly endsAt: Date | null
  readonly roles: readonly string[]
}

export interface MembershipListInput {
  readonly organisationId: string
  readonly hospitalId?: string | null
}

export interface RevokeMembershipInput {
  readonly id: string
  readonly at: Date
  readonly revokedBy: string
  readonly reason: string
}

export interface MembershipRepository {
  findById(id: string): Promise<MembershipSummary | null>
  list(input: MembershipListInput, page: PageRequest): Promise<Page<MembershipSummary>>
  suspend(id: string, at: Date): Promise<boolean>
  revoke(input: RevokeMembershipInput): Promise<boolean>
  countActiveOrganisationAdmins(organisationId: string): Promise<number>
}

const MEMBERSHIP_SELECT = `
  select
    membership.id,
    membership.user_id,
    app_user.email::text as email,
    app_user.display_name,
    membership.organisation_id,
    membership.hospital_id,
    membership.status,
    membership.accepted_at,
    upper(membership.validity) as ends_at,
    coalesce(
      array_agg(distinct role.key order by role.key)
        filter (where role.key is not null),
      '{}'::text[]
    ) as roles
  from control.membership as membership
  join identity.app_user as app_user on app_user.id = membership.user_id
  left join control.membership_role as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.revoked_at is null
   and membership_role.validity @> now()
  left join control.role as role on role.id = membership_role.role_id
`

const MEMBERSHIP_GROUP = ' group by membership.id, app_user.email, app_user.display_name'

/** SQL for one aggregate: no policy, no transaction and no HTTP behaviour. */
export function createMembershipRepository(db: DatabaseQuery): MembershipRepository {
  return {
    async findById(id) {
      const result = await db.query(
        `${MEMBERSHIP_SELECT} where membership.id = $1${MEMBERSHIP_GROUP}`,
        [id],
      )
      return isEmpty(result) ? null : mapMembership(result.rows[0])
    },

    async list(input, page) {
      const result = await db.query(
        `${MEMBERSHIP_SELECT}
         where membership.organisation_id = $1
           and ($2::uuid is null or membership.hospital_id = $2)
         ${MEMBERSHIP_GROUP}
         order by app_user.display_name, app_user.email, membership.id
         limit $3 offset $4`,
        [input.organisationId, input.hospitalId ?? null, page.limit + 1, page.offset],
      )
      return pageOf(result.rows.map(mapMembership), page)
    },

    async suspend(id, at) {
      const result = await db.query(
        `update control.membership
            set status = 'suspended', suspended_at = $2
          where id = $1 and status = 'active'
          returning id`,
        [id, at],
      )
      return result.rows.length > 0
    },

    async revoke(input) {
      const result = await db.query(
        `update control.membership
            set status = 'revoked', revoked_at = $2, revoked_by = $3,
                revoke_reason = $4, validity = tstzrange(lower(validity), $2, '[)')
          where id = $1 and status in ('active', 'suspended')
          returning id`,
        [input.id, input.at, input.revokedBy, input.reason],
      )
      return result.rows.length > 0
    },

    async countActiveOrganisationAdmins(organisationId) {
      const result = await db.query(
        `select count(distinct membership.id)::int as count
           from control.membership as membership
           join control.membership_role as membership_role
             on membership_role.membership_id = membership.id
            and membership_role.revoked_at is null
            and membership_role.validity @> now()
           join control.role_permission as role_permission
             on role_permission.role_id = membership_role.role_id
          where membership.organisation_id = $1
            and membership.hospital_id is null
            and membership.status = 'active'
            and membership.validity @> now()
            and role_permission.permission_key = 'organisation.manage'`,
        [organisationId],
      )
      // count(*) always returns one row; ::int keeps it a JS number.
      const row = result.rows[0]
      return row === undefined ? 0 : integerField(rowRecord(row), 'count')
    },
  }
}

function mapMembership(value: unknown): MembershipSummary {
  const row = rowRecord(value)
  return {
    id: stringField(row, 'id'),
    userId: stringField(row, 'user_id'),
    email: stringField(row, 'email'),
    displayName: stringField(row, 'display_name'),
    organisationId: stringField(row, 'organisation_id'),
    hospitalId: nullableStringField(row, 'hospital_id'),
    status: stringField(row, 'status') as MembershipStatus,
    acceptedAt: dateField(row, 'accepted_at'),
    endsAt: nullableDateField(row, 'ends_at'),
    roles: textArrayField(row, 'roles'),
  }
}
