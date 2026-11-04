import type { DatabaseQuery } from '../db/pool'
import {
  dateField,
  hasSqlState,
  nullableDateField,
  nullableStringField,
  rowRecord,
  stringField,
} from '../db/rows'

export type AppUserStatus = 'active' | 'suspended' | 'deactivated'

export interface AppUser {
  readonly id: string
  readonly identityIssuer: string
  readonly zitadelSubject: string
  readonly email: string
  readonly emailVerifiedAt: Date | null
  readonly displayName: string
  readonly homeOrganisationId: string | null
  readonly status: AppUserStatus
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly lastLoginAt: Date | null
}

export interface IdentityProfile {
  readonly identityIssuer: string
  readonly zitadelSubject: string
  readonly email: string
  readonly emailVerifiedAt: Date | null
  readonly displayName: string
  readonly homeOrganisationId: string | null
}

/**
 * The same email can only back one identity. The login flow answers this with
 * its generic rejection rather than a conflict, so the account is not an
 * existence oracle.
 */
export class AppUserEmailConflictError extends Error {
  constructor() {
    super('another identity already uses this email address')
    this.name = 'AppUserEmailConflictError'
  }
}

export interface AppUserRepository {
  upsertFromIdentity(profile: IdentityProfile): Promise<AppUser>
  findById(id: string): Promise<AppUser | null>
  findByEmail(email: string): Promise<AppUser | null>
  findBySubject(identityIssuer: string, zitadelSubject: string): Promise<AppUser | null>
  markLogin(id: string, at: Date): Promise<AppUser | null>
  setStatus(id: string, status: AppUserStatus): Promise<AppUser | null>
  /** Record the first organisation a user belongs to; later claims keep the first. */
  claimHomeOrganisation(id: string, organisationId: string): Promise<void>
}

const COLUMNS = `
  id, identity_issuer, zitadel_sub, email, email_verified_at, display_name,
  home_organisation_id, status, created_at, updated_at, last_login_at
`

export function createAppUserRepository(db: DatabaseQuery): AppUserRepository {
  return {
    /**
     * Create or refresh the local user for one Zitadel subject. The subject is
     * the key, never the email. A deactivated user stays deactivated.
     */
    async upsertFromIdentity(profile) {
      try {
        const result = await db.query(
          `insert into identity.app_user
             (identity_issuer, zitadel_sub, email, email_verified_at, display_name,
              home_organisation_id)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (identity_issuer, zitadel_sub) do update set
             email = excluded.email,
             email_verified_at = coalesce(
               excluded.email_verified_at,
               identity.app_user.email_verified_at
             ),
             display_name = excluded.display_name
           returning ${COLUMNS}`,
          [
            profile.identityIssuer,
            profile.zitadelSubject,
            profile.email,
            profile.emailVerifiedAt,
            profile.displayName,
            profile.homeOrganisationId,
          ],
        )

        return mapRow(result.rows[0])
      } catch (error) {
        if (isEmailConflict(error)) throw new AppUserEmailConflictError()
        throw error
      }
    },

    async findById(id) {
      const result = await db.query(
        `select ${COLUMNS} from identity.app_user where id = $1`,
        [id],
      )
      return mapOptionalRow(result.rows[0])
    },

    async findByEmail(email) {
      const result = await db.query(
        `select ${COLUMNS} from identity.app_user where email = $1`,
        [email],
      )
      return mapOptionalRow(result.rows[0])
    },

    async findBySubject(identityIssuer, zitadelSubject) {
      const result = await db.query(
        `select ${COLUMNS}
           from identity.app_user
          where identity_issuer = $1 and zitadel_sub = $2`,
        [identityIssuer, zitadelSubject],
      )
      return mapOptionalRow(result.rows[0])
    },

    /**
     * The status predicate closes the race where an administrator suspends the
     * user after the login check but before the session is created.
     */
    async markLogin(id, at) {
      const result = await db.query(
        `update identity.app_user
            set last_login_at = greatest($2, created_at)
          where id = $1 and status = 'active'
          returning ${COLUMNS}`,
        [id, at],
      )
      return mapOptionalRow(result.rows[0])
    },

    async setStatus(id, status) {
      const result = await db.query(
        `update identity.app_user
            set status = $2
          where id = $1
          returning ${COLUMNS}`,
        [id, status],
      )
      return mapOptionalRow(result.rows[0])
    },

    async claimHomeOrganisation(id, organisationId) {
      await db.query(
        `update identity.app_user
            set home_organisation_id = $2
          where id = $1 and home_organisation_id is null`,
        [id, organisationId],
      )
    },
  }
}

function mapOptionalRow(row: unknown): AppUser | null {
  return row === undefined ? null : mapRow(row)
}

function mapRow(value: unknown): AppUser {
  if (value === undefined) throw new Error('identity.app_user write returned no row')

  const row = rowRecord(value)
  const status = stringField(row, 'status')
  if (status !== 'active' && status !== 'suspended' && status !== 'deactivated') {
    throw new Error('database field status is not a known user status')
  }

  return {
    id: stringField(row, 'id'),
    identityIssuer: stringField(row, 'identity_issuer'),
    zitadelSubject: stringField(row, 'zitadel_sub'),
    email: stringField(row, 'email'),
    emailVerifiedAt: nullableDateField(row, 'email_verified_at'),
    displayName: stringField(row, 'display_name'),
    homeOrganisationId: nullableStringField(row, 'home_organisation_id'),
    status,
    createdAt: dateField(row, 'created_at'),
    updatedAt: dateField(row, 'updated_at'),
    lastLoginAt: nullableDateField(row, 'last_login_at'),
  }
}

function isEmailConflict(error: unknown): boolean {
  return (
    hasSqlState(error, '23505') &&
    Reflect.get(error as object, 'constraint') === 'app_user_email_key'
  )
}
