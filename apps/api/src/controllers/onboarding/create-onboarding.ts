import type { AuditSink } from '../../shared/audit-writer'
import type { DatabaseQuery, TransactionRunner } from '../../db/pool'
import type { AdminRequestContext } from '../../guards/admin-context'
import { AppError, ConflictError, conflict, ruleViolation } from '../../shared/errors'
import { recordAdminChange } from '../../shared/change-log'
import { createMembershipRepository } from '../../repositories/membership-repository'
import { createAppUserRepository } from '../../repositories/app-user-repository'
import { createOrganisationRepository } from '../../repositories/organisation-repository'
import type { OrganisationIdentity } from '../admin/dependencies'
import { provisionOrganisation } from '../admin/organisations/provision'
import type { OrganisationStatus } from '../../repositories/organisation-repository'

export interface OnboardingDependencies {
  readonly db: DatabaseQuery
  readonly transaction: TransactionRunner
  readonly audit: AuditSink
  readonly organisationIdentity: OrganisationIdentity
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
  if (await createMembershipRepository(dependencies.db).hasActiveForUser(userId)) {
    throw onboardingComplete()
  }

  const { organisation, roles } = await provisionOrganisation(dependencies, context, {
    name,
    slug,
    roleTemplates: ['org_admin'],
  })
  const roleId = roles.get('org_admin')
  if (roleId === undefined) throw new Error('organisation role template did not return a role')

  return dependencies.transaction(async (db) => {
    const memberships = createMembershipRepository(db)
    await createOrganisationRepository(db).lockClaim(slug)

    if (await memberships.hasActiveForUser(userId)) throw onboardingComplete()
    if ((await memberships.countInOrganisation(organisation.id)) > 0) {
      throw conflict('Organisation address is already in use.')
    }

    let membershipId: string
    try {
      membershipId = await memberships.createFromInvitation({
        userId,
        organisationId: organisation.id,
        hospitalId: null,
        roleIds: [roleId],
        assignedBy: userId,
      })
    } catch (error) {
      if (error instanceof ConflictError) throw onboardingComplete()
      throw error
    }

    await createAppUserRepository(db).claimHomeOrganisation(userId, organisation.id)
    await recordAdminChange(
      dependencies.audit,
      context,
      {
        targetType: 'membership',
        targetId: membershipId,
        organisationId: organisation.id,
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
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      status: organisation.status,
    }
  })
}

function onboardingComplete(): AppError {
  return new AppError('CONFLICT', 409, 'Your account already has access.')
}
