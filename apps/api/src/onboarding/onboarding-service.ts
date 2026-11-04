import type { Pool } from 'pg'
import { AuditWriter } from '../audit/audit-writer'
import type { AuditSink } from '../audit/audit-writer'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import { rowRecord, stringField } from '../db/rows'
import type { MembershipAdminRepository } from '../admin/membership-admin-repository'
import type { Organisation } from '../admin/organisation-repository'
import { AppError } from '../shared/errors'

export interface OnboardingProvisioner {
  provision(input: { name: string; slug: string }): Promise<Organisation>
}

export interface OnboardingContext {
  readonly userId: string
  readonly sessionId: string | null
  readonly requestId: string | null
  readonly ip: string | null
  readonly userAgentHash: Buffer | null
}

export interface OnboardingInput {
  readonly name: string
  readonly slug: string
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
export class OnboardingService {
  constructor(
    private readonly pool: Pool,
    private readonly provisioning: OnboardingProvisioner,
    private readonly memberships: MembershipAdminRepository,
    private readonly audit: AuditSink,
  ) {}

  async create(context: OnboardingContext, input: OnboardingInput): Promise<Organisation> {
    const name = input.name.trim().replace(/\s+/g, ' ')
    if (name.length < 1 || name.length > 200) {
      throw new AppError('INVALID_NAME', 422, 'Organisation name is not valid.')
    }
    const slug = input.slug.trim().toLowerCase()
    if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) {
      throw new AppError('INVALID_SLUG', 422, 'Organisation address is not valid.')
    }

    // Reject an account that already has access before calling the identity
    // provider. The transaction below rechecks under its lock, but this check
    // keeps a repeated request from provisioning an organisation first.
    if (await hasActiveMembership(this.pool, context.userId)) throw onboardingComplete()

    const claimed = await this.provisioning.provision({ name, slug })

    return withTransaction(this.pool, async (db) => {
      await db.query('select pg_advisory_xact_lock(hashtext($1))', ['onboarding:' + slug])

      if (await hasActiveMembership(db, context.userId)) throw onboardingComplete()

      const members = await db.query(
        'select count(*)::int as count from control.membership where organisation_id = $1',
        [claimed.id],
      )
      if (readCount(members.rows[0]) > 0) {
        throw new AppError('SLUG_TAKEN', 409, 'Organisation address is already in use.')
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
        membershipId = await this.memberships.createFromInvitation(
          {
            userId: context.userId,
            organisationId: claimed.id,
            hospitalId: null,
            roleIds: [roleId],
            assignedBy: context.userId,
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
        [context.userId, claimed.id],
      )

      await new AuditWriter(db).write({
        actorUserId: context.userId,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: claimed.id,
        hospitalId: null,
        eventType: 'membership.change',
        outcome: 'success',
        targetType: 'membership',
        targetId: membershipId,
        requestId: context.requestId,
        reason: 'first organisation',
        reasonCode: 'membership.onboard',
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: {
          membership_id: membershipId,
          from_status: 'none',
          to_status: 'active',
        },
      })

      return claimed
    })
  }
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
  return new AppError('ONBOARDING_COMPLETE', 409, 'Your account already has access.')
}

function readCount(value: unknown): number {
  if (value === undefined) return 0
  const count = rowRecord(value).count
  return typeof count === 'number' ? count : 0
}
