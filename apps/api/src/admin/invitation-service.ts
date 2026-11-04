import type { Pool } from 'pg'
import { AppError } from '../shared/errors'
import { hashToken, mintToken } from '../shared/tokens'
import { AuditWriter } from '../audit/audit-writer'
import type { AuthorizationRepository, AccessTarget } from '../access/authorization-repository'
import type { AppUser, AppUserRepository } from '../identity/app-user-repository'
import type { AdminRequestContext } from './admin-context'
import type { AuditSink } from '../audit/audit-writer'
import { withTransaction } from '../db/pool'
import type { OrganisationRepository } from './organisation-repository'
import type { HospitalRepository } from './hospital-repository'
import {
  MembershipAdminRepository,
  type OrganisationRole,
} from './membership-admin-repository'
import {
  InvitationRepository,
  findInvitationByTokenHashForUpdate,
  type Invitation,
  type InvitationKind,
} from './invitation-repository'
import type { ZitadelManagementClient } from './zitadel-management-client'
import { asAdminError, conflict, forbidden, notFound } from './admin-errors'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface InvitationMailer {
  send(input: {
    to: string
    token: string
    organisationName: string
    hospitalName: string | null
    expiresAt: Date
  }): Promise<void>
}

export interface InvitationServiceDependencies {
  readonly pool: Pool
  readonly invitations: InvitationRepository
  readonly organisations: OrganisationRepository
  readonly hospitals: HospitalRepository
  readonly memberships: MembershipAdminRepository
  readonly users: AppUserRepository
  readonly authorization: AuthorizationRepository
  readonly zitadel: ZitadelManagementClient
  readonly mailer: InvitationMailer
  readonly audit: AuditSink
  readonly clock?: () => Date
}

export class InvitationService {
  private readonly clock: () => Date

  constructor(private readonly dependencies: InvitationServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date())
  }

  async create(context: AdminRequestContext, input: {
    email: string
    displayName?: string
    organisationId: string
    hospitalId?: string | null
    roleIds: readonly string[]
  }): Promise<Invitation> {
    const actor = context.actor
    const email = normaliseEmail(input.email)
    const organisation = await this.dependencies.organisations.findById(input.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const hospital = input.hospitalId
      ? await this.dependencies.hospitals.findById(input.hospitalId)
      : null
    if (input.hospitalId && (hospital === null || hospital.organisationId !== organisation.id)) {
      throw notFound('Hospital not found.')
    }

    await this.requireManage(actor.id, {
      organisationId: organisation.id,
      hospitalId: hospital?.id ?? null,
    })
    await this.validateRoles(organisation.id, hospital?.id ?? null, input.roleIds)

    const pending = await this.dependencies.invitations.findPendingForScope({
      email,
      organisationId: organisation.id,
      hospitalId: hospital?.id ?? null,
    })
    if (pending !== null) {
      const replaced = await this.replace(actor, pending, organisation.name, hospital?.name ?? null)
      await this.auditChange(context, replaced, 'invitation.resend')
      return replaced
    }

    const existing = await this.dependencies.users.findByEmail(email)
    if (existing !== null) {
      if (existing.status !== 'active') throw conflict('This identity is not active.')
      await this.requireNoMembership(existing.id, organisation.id, hospital?.id ?? null)
      const issued = await this.issue({
        actor,
        email,
        kind: 'existing_user',
        zitadelSub: existing.zitadelSubject,
        organisationId: organisation.id,
        organisationName: organisation.name,
        hospitalId: hospital?.id ?? null,
        hospitalName: hospital?.name ?? null,
        roleIds: input.roleIds,
      })
      await this.auditChange(context, issued, 'invitation.created')
      return issued
    }

    if (organisation.zitadelOrgId === null) {
      throw new AppError('ORGANISATION_NOT_PROVISIONED', 422, 'Organisation is not provisioned.')
    }
    const displayName = input.displayName?.trim() || email.split('@')[0] || email
    let subject: string
    try {
      subject = await this.dependencies.zitadel.createHumanUser(
        organisation.zitadelOrgId,
        { email, displayName },
      )
    } catch (error) {
      throw asAdminError(error)
    }
    try {
      const issued = await this.issue({
        actor,
        email,
        kind: 'new_user',
        zitadelSub: subject,
        organisationId: organisation.id,
        organisationName: organisation.name,
        hospitalId: hospital?.id ?? null,
        hospitalName: hospital?.name ?? null,
        roleIds: input.roleIds,
      })
      await this.auditChange(context, issued, 'invitation.created')
      return issued
    } catch (error) {
      try {
        await this.dependencies.zitadel.deactivateUser(organisation.zitadelOrgId, subject)
      } catch {
        // The identity stays disabled on the provider side after a failed issue.
      }
      throw error
    }
  }

  async list(
    context: AdminRequestContext,
    input: { organisationId: string; hospitalId?: string | null },
  ): Promise<Invitation[]> {
    await this.requireManage(context.actor.id, {
      organisationId: input.organisationId,
      hospitalId: input.hospitalId ?? null,
    })
    return this.dependencies.invitations.list(input)
  }

  async resend(context: AdminRequestContext, invitationId: string): Promise<Invitation> {
    const actor = context.actor
    const invitation = await this.dependencies.invitations.findById(invitationId)
    if (invitation === null) throw notFound('Invitation not found.')
    await this.requireManage(actor.id, {
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
    })
    if (invitation.status !== 'pending' || invitation.expiresAt <= this.clock()) {
      throw new AppError('INVITATION_NOT_PENDING', 409, 'Invitation is no longer pending.')
    }
    const organisation = await this.dependencies.organisations.findById(invitation.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const hospital = invitation.hospitalId
      ? await this.dependencies.hospitals.findById(invitation.hospitalId)
      : null
    const replaced = await this.replace(actor, invitation, organisation.name, hospital?.name ?? null)
    await this.auditChange(context, replaced, 'invitation.resend')
    return replaced
  }

  async revoke(context: AdminRequestContext, invitationId: string): Promise<void> {
    const actor = context.actor
    const invitation = await this.dependencies.invitations.findById(invitationId)
    if (invitation === null) throw notFound('Invitation not found.')
    await this.requireManage(actor.id, {
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
    })
    const revoked = await this.dependencies.invitations.revokePending(invitationId, this.clock())
    if (!revoked) throw conflict('Invitation is no longer pending.')
    await this.auditChange(context, invitation, 'invitation.revoked')
  }

  async accept(context: AdminRequestContext, token: string): Promise<Invitation> {
    const user = context.actor
    const tokenHash = hashToken(token)
    return withTransaction(this.dependencies.pool, async (db) => {
      const invitation = await findInvitationByTokenHashForUpdate(db, tokenHash)
      if (invitation === null) throw notFound('Invitation not found.')
      if (invitation.status !== 'pending') throw conflict('Invitation is no longer pending.')
      const now = this.clock()
      if (invitation.expiresAt <= now) {
        throw new AppError('INVITATION_EXPIRED', 410, 'Invitation has expired.')
      }
      if (invitation.kind === 'existing_user' && invitation.zitadelSub !== user.zitadelSubject) {
        throw forbidden()
      }
      if (invitation.kind === 'new_user' && invitation.zitadelSub !== null &&
          invitation.zitadelSub !== user.zitadelSubject) {
        throw forbidden()
      }
      await this.requireNoMembership(
        user.id,
        invitation.organisationId,
        invitation.hospitalId,
      )

      const memberships = new MembershipAdminRepository(db)
      const audit = new AuditWriter(db)
      try {
        await memberships.createFromInvitation({
          userId: user.id,
          organisationId: invitation.organisationId,
          hospitalId: invitation.hospitalId,
          roleIds: invitation.roleIds,
          assignedBy: invitation.invitedBy,
        })
      } catch (error) {
        throw asAdminError(error)
      }
      const accepted = await this.dependencies.invitations.markAcceptedWith(db, {
        id: invitation.id,
        acceptedByUserId: user.id,
        at: now,
      })
      if (!accepted) throw conflict('Invitation is no longer pending.')

      await audit.write({
        actorUserId: user.id,
        actorType: 'user',
        sessionId: context.sessionId,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
        eventType: 'invitation.accept',
        outcome: 'success',
        targetType: 'invitation',
        targetId: invitation.id,
        requestId: context.requestId,
        ip: context.ip,
        userAgentHash: context.userAgentHash,
        metadata: { invitation_id: invitation.id },
      })
      return { ...invitation, status: 'accepted', acceptedAt: now, acceptedByUserId: user.id }
    })
  }

  private async issue(input: {
    actor: AppUser
    email: string
    kind: InvitationKind
    zitadelSub: string | null
    organisationId: string
    organisationName: string
    hospitalId: string | null
    hospitalName: string | null
    roleIds: readonly string[]
  }): Promise<Invitation> {
    const minted = mintToken()
    const expiresAt = new Date(this.clock().getTime() + INVITATION_TTL_MS)
    const invitation = await this.dependencies.invitations.create({
      email: input.email,
      organisationId: input.organisationId,
      hospitalId: input.hospitalId,
      kind: input.kind,
      zitadelSub: input.zitadelSub,
      tokenHash: minted.tokenHash,
      invitedBy: input.actor.id,
      expiresAt,
      roleIds: input.roleIds,
    })

    // Both kinds receive the local link. A new user cannot accept until their
    // provider account is usable, but the link keeps an explicit token path that
    // does not depend on a verified address.
    try {
      await this.dependencies.mailer.send({
        to: input.email,
        token: minted.token,
        organisationName: input.organisationName,
        hospitalName: input.hospitalName,
        expiresAt,
      })
    } catch (error) {
      await this.dependencies.invitations.revokePending(invitation.id, this.clock())
      throw error
    }
    return invitation
  }

  private async replace(
    actor: AppUser,
    invitation: Invitation,
    organisationName: string,
    hospitalName: string | null,
  ): Promise<Invitation> {
    const revoked = await this.dependencies.invitations.revokePending(invitation.id, this.clock())
    if (!revoked) throw conflict('Invitation is no longer pending.')
    if (invitation.kind === 'new_user' && invitation.zitadelSub !== null) {
      const organisation = await this.dependencies.organisations.findById(invitation.organisationId)
      if (organisation?.zitadelOrgId) {
        try {
          await this.dependencies.zitadel.resendInitialization(
            organisation.zitadelOrgId,
            invitation.zitadelSub,
          )
        } catch (error) {
          throw asAdminError(error)
        }
      }
    }
    return this.issue({
      actor,
      email: invitation.email,
      kind: invitation.kind,
      zitadelSub: invitation.zitadelSub,
      organisationId: invitation.organisationId,
      organisationName,
      hospitalId: invitation.hospitalId,
      hospitalName,
      roleIds: invitation.roleIds,
    })
  }

  private async auditChange(
    context: AdminRequestContext,
    invitation: Invitation,
    reasonCode: string,
  ): Promise<void> {
    await this.dependencies.audit.write({
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
      eventType: 'admin.change',
      outcome: 'success',
      targetType: 'invitation',
      targetId: invitation.id,
      requestId: context.requestId,
      reason: reasonCode.replace(/\./g, ' ').replace(/_/g, ' '),
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { resource_type: 'invitation', resource_id: invitation.id },
    })
  }

  private async requireManage(actorId: string, target: AccessTarget): Promise<void> {
    const allowed =
      (await this.dependencies.authorization.hasPlatformPermission(actorId, 'platform.manage')) ||
      (await this.dependencies.authorization.hasPermission(actorId, 'membership.manage', target))
    if (!allowed) throw forbidden()
  }

  private async requireNoMembership(
    userId: string,
    organisationId: string,
    hospitalId: string | null,
  ): Promise<void> {
    const membership = await this.dependencies.memberships.findActiveMembershipForUser({
      userId,
      organisationId,
      hospitalId,
    })
    if (membership !== null) throw conflict('This person already has access.')
  }

  private async validateRoles(
    organisationId: string,
    hospitalId: string | null,
    roleIds: readonly string[],
  ): Promise<OrganisationRole[]> {
    if (roleIds.length === 0) {
      throw new AppError('ROLE_REQUIRED', 422, 'At least one role is required.')
    }
    const roles = await this.dependencies.memberships.listRoles(organisationId)
    const selected = roleIds.map((id) => roles.find((role) => role.id === id))
    if (selected.some((role) => role === undefined)) {
      throw new AppError('ROLE_NOT_FOUND', 422, 'Role is not available in this organisation.')
    }
    const expectedScope = hospitalId === null ? 'organisation' : 'hospital'
    if (selected.some((role) => role!.scope !== expectedScope)) {
      throw new AppError('ROLE_SCOPE_MISMATCH', 422, 'Role scope does not match the invitation.')
    }
    return selected as OrganisationRole[]
  }
}

function normaliseEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
  }
  return email
}
