import type { Pool } from 'pg'
import type { AuditSink } from '../../audit/audit-writer'
import { withTransaction, type DatabaseQuery } from '../../db/pool'
import { rowRecord, stringField } from '../../db/rows'
import type { MembershipAdminRepository } from '../../admin/membership-admin-repository'
import type { Organisation, OrganisationStatus } from '../../admin/organisation-repository'
import type { AdminRequestContext } from '../../guards/admin-context'
import { AppError, conflict, ruleViolation } from '../../shared/errors'
import { recordAdminChange } from '../../shared/change-log'

export interface OnboardingProvisioner {
  provision(input: { name: string; slug: string }): Promise<Organisation>
}

export interface OnboardingDependencies {
  readonly pool: Pool
  readonly provisioning: OnboardingProvisioner
  readonly memberships: Pick<MembershipAdminRepository, 'createFromInvitation'>
  readonly audit: AuditSink
}

export interface OnboardingInput {
  readonly name: string
  readonly slug: string
}

export interface OrganisationResponse {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly status: OrganisationStatus
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'dashboard',
  'invitations',
  'login',
  'onboarding',
  'signup',
  'www',
])

/**
 * Give a new account its first organisation and an active organisation-admin
 * membership. Only a user with no active membership may claim an organisation,
 * and an organisation that already has a member cannot be claimed by slug.
 */
export async function createOnboarding(
  dependencies: OnboardingDependencies,
  context: AdminRequestContext,
  input: OnboardingInput,
): Promise<OrganisationResponse> {
  const userId = context.actor.id
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 200) {
    throw ruleViolation('Organisation name is not valid.')
  }
  const slug = input.slug.trim().toLowerCase()
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) {
    throw ruleViolation('Organisation address is not valid.')
  }

  // Reject an account that already has access before calling the identity
  // provider. The transaction rechecks under its lock, but this keeps a
  // repeated request from provisioning an organisation first.
  if (await hasActiveMembership(dependencies.pool, userId)) throw onboardingComplete()

  const claimed = await dependencies.provisioning.provision({ name, slug })

  return withTransaction(dependencies.pool, async (db) => {
    await db.query('select pg_advisory_xact_lock(hashtext($1))', ['onboarding:' + slug])

    if (await hasActiveMembership(db, userId)) throw onboardingComplete()

    const members = await db.query(
      'select count(*)::int as count from control.membership where organisation_id = $1',
      [claimed.id],
    )
    if (readCount(members.rows[0]) > 0) {
      throw conflict('Organisation address is already in use.')
    }
    if (claimed.status !== 'active') {
      throw new AppError(
        'ONBOARDING_UNAVAILABLE',
        503,
        'Organisation provisioning is not available.',
      )
    }

    const role = await db.query(
      "select control.instantiate_role_template($1, 'org_admin') as role_id",
      [claimed.id],
    )
    const roleId = stringField(rowRecord(role.rows[0]), 'role_id')

    let membershipId: string
    try {
      membershipId = await dependencies.memberships.createFromInvitation(
        {
          userId,
          organisationId: claimed.id,
          hospitalId: null,
          roleIds: [roleId],
          assignedBy: userId,
        },
        db,
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'MembershipConflictError') {
        throw onboardingComplete()
      }
      throw error
    }

    await db.query(
      `update identity.app_user
          set home_organisation_id = $2
        where id = $1 and home_organisation_id is null`,
      [userId, claimed.id],
    )

    await recordAdminChange(
      dependencies.audit,
      context,
      {
        targetType: 'membership',
        targetId: membershipId,
        organisationId: claimed.id,
        hospitalId: null,
      },
      'membership.onboard',
      db,
      {
        eventType: 'membership.change',
        reason: 'first organisation',
        metadata: {
          membership_id: membershipId,
          from_status: 'none',
          to_status: 'active',
        },
      },
    )

    return {
      id: claimed.id,
      name: claimed.name,
      slug: claimed.slug,
      status: claimed.status,
    }
  })
}

async function hasActiveMembership(db: DatabaseQuery, userId: string): Promise<boolean> {
  const active = await db.query(
    `select 1 from control.membership
      where user_id = $1 and status = 'active' and validity @> now()
      limit 1`,
    [userId],
  )
  return active.rows.length > 0
}

function onboardingComplete(): AppError {
  return new AppError('CONFLICT', 409, 'Your account already has access.')
}

function readCount(value: unknown): number {
  if (value === undefined) return 0
  const count = rowRecord(value).count
  return typeof count === 'number' ? count : 0
}
