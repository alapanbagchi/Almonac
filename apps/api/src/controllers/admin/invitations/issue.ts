import type { AdminDependencies } from '../dependencies'
import type { AdminRequestContext } from '../../../guards/admin-context'
import type { AccessTarget } from '../../../shared/access-target'
import type { AppUser } from '../../../repositories/app-user-repository'
import type { Hospital } from '../../../repositories/hospital-repository'
import type { Organisation } from '../../../repositories/organisation-repository'
import type { OrganisationRole } from '../../../repositories/role-repository'
import {
  createInvitationRepository,
  type Invitation,
  type NewInvitation,
} from '../../../repositories/invitation-repository'
import { createHospitalRepository } from '../../../repositories/hospital-repository'
import { createMembershipRepository } from '../../../repositories/membership-repository'
import { createOrganisationRepository } from '../../../repositories/organisation-repository'
import { createRoleRepository } from '../../../repositories/role-repository'
import type { DatabaseQuery } from '../../../db/pool'
import { recordAdminChange } from '../../../shared/change-log'
import { conflict, forbidden, notFound, ruleViolation } from '../../../shared/errors'
import { mintToken } from '../../../shared/tokens'

/** How long an invitation and its sign-in link stay valid. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** What the invitation mail needs to make sense to the recipient. */
export interface InvitationDelivery {
  readonly organisationName: string
  readonly hospitalName: string | null
}

/**
 * The outbound mail port. `createSmtpMailer` satisfies it structurally, so the
 * controllers stay testable without an SMTP server.
 */
export interface InvitationMailer {
  send(input: {
    to: string
    token: string
    organisationName: string
    hospitalName: string | null
    expiresAt: Date
  }): Promise<void>
}

/**
 * The identity provider port: the slice needs three Zitadel calls and nothing
 * else, so `ZitadelManagementClient` plugs in without being imported here.
 */
export interface IdentityProvider {
  createHumanUser(
    organisationId: string | null,
    input: { email: string; displayName: string },
  ): Promise<string>
  resendInitialization(organisationId: string, userId: string): Promise<void>
  deactivateUser(organisationId: string, userId: string): Promise<void>
}

/** Admin capabilities plus the two outbound ports invitations need. */
export interface InvitationDependencies extends AdminDependencies {
  readonly mailer: InvitationMailer
  readonly identity: IdentityProvider
}

/** The organisation and optional hospital an invitation belongs to. */
export interface InvitationScope {
  readonly organisation: Organisation
  readonly hospital: Hospital | null
  readonly target: AccessTarget
  readonly delivery: InvitationDelivery
}

/** The fields of a new invitation that the caller supplies. */
export type InvitationDraft = Omit<NewInvitation, 'tokenHash' | 'invitedBy' | 'expiresAt'>

export function now(): Date {
  return new Date()
}

/** Load and check the organisation (and hospital) an invitation names. */
export async function invitationScope(
  db: DatabaseQuery,
  organisationId: string,
  hospitalId: string | null,
): Promise<InvitationScope> {
  const organisation = await createOrganisationRepository(db).findById(organisationId)
  if (organisation === null) throw notFound('Organisation not found.')

  if (hospitalId === null) {
    return {
      organisation,
      hospital: null,
      target: { organisationId, hospitalId: null },
      delivery: { organisationName: organisation.name, hospitalName: null },
    }
  }

  const hospital = await createHospitalRepository(db).findById(hospitalId)
  // A hospital of another organisation is not a hospital the caller named.
  if (hospital === null || hospital.organisationId !== organisationId) {
    throw notFound('Hospital not found.')
  }
  return {
    organisation,
    hospital,
    target: { organisationId, hospitalId },
    delivery: { organisationName: organisation.name, hospitalName: hospital.name },
  }
}

/** Check the roles exist in the organisation and match the invitation scope. */
export async function requireRoles(
  db: DatabaseQuery,
  target: AccessTarget,
  roleIds: readonly string[],
): Promise<string[]> {
  if (roleIds.length === 0) throw ruleViolation('At least one role is required.')
  const roles = await createRoleRepository(db).findAll(target.organisationId, roleIds)
  return matchRoles(roles, roleIds, target.hospitalId == null ? 'organisation' : 'hospital')
}

/**
 * Keep the requested order, reject a role from another organisation and a role
 * whose scope differs from the invitation's. Pure so it can be tested alone.
 */
export function matchRoles(
  available: readonly OrganisationRole[],
  roleIds: readonly string[],
  expected: 'organisation' | 'hospital',
): string[] {
  const byId = new Map(available.map((role) => [role.id, role]))
  return roleIds.map((roleId) => {
    const role = byId.get(roleId)
    if (role === undefined) throw ruleViolation('Role is not available in this organisation.')
    if (role.scope !== expected) throw ruleViolation('Role scope does not match the invitation.')
    return role.id
  })
}

/** Refuse a person who already has an active membership at this scope. */
export async function requireNoMembership(
  db: DatabaseQuery,
  userId: string,
  target: AccessTarget,
): Promise<void> {
  const membership = await createMembershipRepository(db).findActiveForUser({
    userId,
    organisationId: target.organisationId,
    hospitalId: target.hospitalId ?? null,
  })
  if (membership !== null) throw conflict('This person already has access.')
}

/** Re-send the identity provider's initialisation mail for a pending new user. */
export async function resendInitialisation(
  d: InvitationDependencies,
  organisation: Organisation,
  invitation: Invitation,
): Promise<void> {
  if (invitation.kind !== 'new_user' || invitation.zitadelSub === null) return
  if (organisation.zitadelOrgId === null) return
  await d.identity.resendInitialization(organisation.zitadelOrgId, invitation.zitadelSub)
}

/** The invitation fields worth carrying across when a link is reissued. */
export function draftOf(invitation: Invitation): InvitationDraft {
  return {
    email: invitation.email,
    organisationId: invitation.organisationId,
    hospitalId: invitation.hospitalId,
    kind: invitation.kind,
    zitadelSub: invitation.zitadelSub,
    roleIds: invitation.roleIds,
  }
}

/** Load an invitation and authorise the actor on its scope, in that order. */
export async function requireInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  invitationId: string,
): Promise<Invitation> {
  const invitation = await createInvitationRepository(d.db).findById(invitationId)
  if (invitation === null) throw notFound('Invitation not found.')
  await d.authorize(context.actor.id, 'membership.manage', {
    organisationId: invitation.organisationId,
    hospitalId: invitation.hospitalId,
  })
  return invitation
}

/**
 * Revoke a pending invitation and audit it inside the caller's transaction.
 * The row is already loaded, so its target fields are the audit target.
 */
export async function revokePendingInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  db: DatabaseQuery,
  invitation: Invitation,
  options: { ignoreMissing?: boolean } = {},
): Promise<void> {
  const revoked = await createInvitationRepository(db).revokePending(invitation.id, now())
  if (!revoked && options.ignoreMissing !== true) {
    throw conflict('Invitation is no longer pending.')
  }
  await recordAdminChange(
    d.audit,
    context,
    {
      targetType: 'invitation',
      targetId: invitation.id,
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
    },
    'invitation.revoked',
    db,
  )
}

/**
 * Write the invitation and its audit row in one transaction, then deliver it.
 * A failed delivery revokes the row so no live token is left behind.
 */
export async function issue(
  d: InvitationDependencies,
  context: AdminRequestContext,
  draft: InvitationDraft,
  delivery: InvitationDelivery,
  options: { reasonCode?: string; replaces?: Invitation } = {},
): Promise<Invitation> {
  const issued = await d.transaction(async (db) => {
    if (options.replaces !== undefined) {
      await revokePendingInvitation(d, context, db, options.replaces)
    }
    const { token, tokenHash } = mintToken()
    const invitation = await createInvitationRepository(db).create({
      ...draft,
      tokenHash,
      invitedBy: context.actor.id,
      expiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
    })
    await recordAdminChange(
      d.audit,
      context,
      {
        targetType: 'invitation',
        targetId: invitation.id,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
      },
      options.reasonCode ?? 'invitation.created',
      db,
    )
    return { invitation, token }
  })

  try {
    await d.mailer.send({
      to: issued.invitation.email,
      token: issued.token,
      organisationName: delivery.organisationName,
      hospitalName: delivery.hospitalName,
      expiresAt: issued.invitation.expiresAt,
    })
  } catch (error) {
    // The token is already persisted; leaving it pending would be a live link
    // nobody received, so the compensating revoke runs before the rethrow.
    await d
      .transaction((db) =>
        revokePendingInvitation(d, context, db, issued.invitation, { ignoreMissing: true }),
      )
      .catch(() => undefined)
    throw error
  }

  return issued.invitation
}

/** The invitation the caller may act on, after scope and role checks. */
export interface PreparedInvitation {
  readonly scope: InvitationScope
  readonly roleIds: string[]
}

export async function prepareInvitation(
  d: InvitationDependencies,
  context: AdminRequestContext,
  input: { organisationId: string; hospitalId: string | null; roleIds: readonly string[] },
): Promise<PreparedInvitation> {
  const scope = await invitationScope(d.db, input.organisationId, input.hospitalId)
  await d.authorize(context.actor.id, 'membership.manage', scope.target)
  const roleIds = await requireRoles(d.db, scope.target, input.roleIds)
  return { scope, roleIds }
}

/** Assert that this actor may accept this invitation right now. Pure. */
export function assertInvitationAcceptable(invitation: Invitation, actor: AppUser, at: Date): void {
  if (invitation.status !== 'pending') throw conflict('Invitation is no longer pending.')
  if (invitation.expiresAt <= at) throw conflict('Invitation has expired.')
  if (invitation.zitadelSub !== null && invitation.zitadelSub !== actor.zitadelSubject) {
    throw forbidden()
  }
}
