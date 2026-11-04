import { requireAdminPermission } from './admin-authorization'
import { asAdminError, conflict, forbidden, notFound } from './admin-errors'
import {
  INVITATION_TTL_MS,
  type InvitationDelivery,
  type InvitationServiceDependencies,
} from './invitation-types'
import type { Invitation } from './invitation-repository'
import { MembershipAdminRepository, type OrganisationRole } from './membership-admin-repository'
import { AppError } from '../shared/errors'
import type { Page } from '../shared/pagination'
import { normaliseEmail } from '../shared/email'
import { hashToken, mintToken } from '../shared/tokens'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import type { AdminRequestContext } from './admin-context'

/** What an issue writes, and the only time the raw token exists. */
interface InvitationIssue {
  readonly invitation: Invitation
  readonly token: string
}

/** The row and roles an invitation is written from. */
interface InvitationDraft {
  readonly actorId: string
  readonly email: string
  readonly kind: Invitation['kind']
  readonly zitadelSub: string | null
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly roleIds: readonly string[]
}

/** Creating, listing, resending, revoking and accepting invitations. */
export class InvitationService {
  constructor(private readonly dependencies: InvitationServiceDependencies) {}

  async create(
    context: AdminRequestContext,
    input: {
      email: string
      displayName?: string
      organisationId: string
      hospitalId?: string | null
      roleIds: readonly string[]
    },
  ): Promise<Invitation> {
    const email = normaliseEmail(input.email)
    if (email === null) throw new AppError('INVALID_EMAIL', 422, 'Email address is not valid.')
    const organisation = await this.dependencies.organisations.findById(input.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const hospitalId = input.hospitalId ?? null
    const hospital = hospitalId === null ? null : await this.dependencies.hospitals.findById(hospitalId)
    if (hospitalId !== null && hospital?.organisationId !== organisation.id) {
      throw notFound('Hospital not found.')
    }
    const scope = { organisationId: organisation.id, hospitalId }
    const delivery = { organisationName: organisation.name, hospitalName: hospital?.name ?? null }

    await this.requireManage(context.actor.id, scope)
    await this.validateRoles(scope.organisationId, scope.hospitalId, input.roleIds)

    const pending = await this.dependencies.invitations.findPendingForScope({ email, ...scope })
    if (pending !== null) return this.replace(context, pending, delivery)

    const existing = await this.dependencies.users.findByEmail(email)
    if (existing !== null) {
      if (existing.status !== 'active') throw conflict('This identity is not active.')
      await this.requireNoMembership(existing.id, scope)
      const issued = await this.issue(context, {
        actorId: context.actor.id,
        email,
        kind: 'existing_user',
        zitadelSub: existing.zitadelSubject,
        ...scope,
        roleIds: input.roleIds,
      })
      await this.deliver(context, issued, delivery)
      return issued.invitation
    }

    if (organisation.zitadelOrgId === null) {
      throw new AppError('RULE_VIOLATION', 422, 'The organisation is not provisioned yet.')
    }
    const displayName = input.displayName?.trim() || email.split('@')[0] || email
    let subject: string
    try {
      subject = await this.dependencies.zitadel.createHumanUser(organisation.zitadelOrgId, {
        email,
        displayName,
      })
    } catch (error) {
      throw asAdminError(error)
    }
    try {
      const issued = await this.issue(context, {
        actorId: context.actor.id,
        email,
        kind: 'new_user',
        zitadelSub: subject,
        ...scope,
        roleIds: input.roleIds,
      })
      await this.deliver(context, issued, delivery)
      return issued.invitation
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
    page: { limit: number; offset: number },
  ): Promise<Page<Invitation>> {
    await this.requireManage(context.actor.id, {
      organisationId: input.organisationId,
      hospitalId: input.hospitalId ?? null,
    })
    return this.dependencies.invitations.list(input, page)
  }

  async resend(context: AdminRequestContext, invitationId: string): Promise<Invitation> {
    const invitation = await this.dependencies.invitations.findById(invitationId)
    if (invitation === null) throw notFound('Invitation not found.')
    await this.requireManage(context.actor.id, invitation)
    if (invitation.status !== 'pending' || invitation.expiresAt <= this.clock()) {
      throw conflict('Invitation is no longer pending.')
    }
    const organisation = await this.dependencies.organisations.findById(invitation.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const hospital =
      invitation.hospitalId === null
        ? null
        : await this.dependencies.hospitals.findById(invitation.hospitalId)
    return this.replace(context, invitation, {
      organisationName: organisation.name,
      hospitalName: hospital?.name ?? null,
    })
  }

  async revoke(context: AdminRequestContext, invitationId: string): Promise<void> {
    const invitation = await this.dependencies.invitations.findById(invitationId)
    if (invitation === null) throw notFound('Invitation not found.')
    await this.requireManage(context.actor.id, invitation)
    await withTransaction(this.dependencies.pool, async (db) => {
      await this.revokePending(db, invitation, context)
    })
  }

  async accept(context: AdminRequestContext, token: string): Promise<Invitation> {
    const user = context.actor
    return withTransaction(this.dependencies.pool, async (db) => {
      const invitation = await this.dependencies.invitations.findByTokenHashForUpdate(db, hashToken(token))
      if (invitation === null) throw notFound('Invitation not found.')
      if (invitation.status !== 'pending') throw conflict('Invitation is no longer pending.')
      // An elapsed invitation and a revoked one are the same state to the
      // invitee: the link no longer works and someone must issue a new one.
      const now = this.clock()
      if (invitation.expiresAt <= now) throw conflict('Invitation has expired.')
      const reserved = invitation.zitadelSub
      if (reserved !== null && reserved !== user.zitadelSubject) throw forbidden()
      await this.requireNoMembership(user.id, invitation)

      try {
        await new MembershipAdminRepository(db).createFromInvitation({
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

      await this.dependencies.audit.write(
        {
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
        },
        db,
      )
      return { ...invitation, status: 'accepted', acceptedAt: now, acceptedByUserId: user.id }
    })
  }

  private clock(): Date {
    return this.dependencies.clock?.() ?? new Date()
  }

  private async issue(
    context: AdminRequestContext,
    draft: InvitationDraft,
  ): Promise<InvitationIssue> {
    return withTransaction(this.dependencies.pool, async (db) => {
      const issued = await this.persist(db, draft)
      await this.dependencies.audit.write(this.change(issued.invitation, 'invitation.created', context), db)
      return issued
    })
  }

  private async persist(db: DatabaseQuery, draft: InvitationDraft): Promise<InvitationIssue> {
    const minted = mintToken()
    const invitation = await this.dependencies.invitations.create(
      {
        email: draft.email,
        organisationId: draft.organisationId,
        hospitalId: draft.hospitalId,
        kind: draft.kind,
        zitadelSub: draft.zitadelSub,
        tokenHash: minted.tokenHash,
        invitedBy: draft.actorId,
        expiresAt: new Date(this.clock().getTime() + INVITATION_TTL_MS),
        roleIds: draft.roleIds,
      },
      db,
    )
    return { invitation, token: minted.token }
  }

  private async deliver(
    context: AdminRequestContext,
    issued: InvitationIssue,
    delivery: InvitationDelivery,
  ): Promise<void> {
    // Both kinds receive the local link. A new user cannot accept until their
    // provider account is usable, but the link keeps an explicit token path that
    // does not depend on a verified address.
    try {
      await this.dependencies.mailer.send({
        to: issued.invitation.email,
        token: issued.token,
        ...delivery,
        expiresAt: issued.invitation.expiresAt,
      })
    } catch (error) {
      try {
        await withTransaction(this.dependencies.pool, async (db) => {
          await this.revokePending(db, issued.invitation, context, true)
        })
      } catch {
        // Keep the delivery failure. An unrevoked invitation still expires.
      }
      throw error
    }
  }

  private async replace(
    context: AdminRequestContext,
    invitation: Invitation,
    delivery: InvitationDelivery,
  ): Promise<Invitation> {
    if (invitation.kind === 'new_user' && invitation.zitadelSub !== null) {
      const organisation = await this.dependencies.organisations.findById(invitation.organisationId)
      if (organisation?.zitadelOrgId) {
        try {
          await this.dependencies.zitadel.resendInitialization(organisation.zitadelOrgId, invitation.zitadelSub)
        } catch (error) {
          throw asAdminError(error)
        }
      }
    }
    const issued = await withTransaction(this.dependencies.pool, async (db) => {
      await this.revokePending(db, invitation, context)
      const created = await this.persist(db, {
        actorId: context.actor.id,
        email: invitation.email,
        kind: invitation.kind,
        zitadelSub: invitation.zitadelSub,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
        roleIds: invitation.roleIds,
      })
      await this.dependencies.audit.write(this.change(created.invitation, 'invitation.resend', context), db)
      return created
    })
    await this.deliver(context, issued, delivery)
    return issued.invitation
  }

  private change(invitation: Invitation, reasonCode: string, context: AdminRequestContext) {
    return {
      actorUserId: context.actor.id,
      actorType: 'user' as const,
      sessionId: context.sessionId,
      organisationId: invitation.organisationId,
      hospitalId: invitation.hospitalId,
      eventType: 'admin.change',
      outcome: 'success' as const,
      targetType: 'invitation',
      targetId: invitation.id,
      requestId: context.requestId,
      reason: reasonCode.replace(/\./g, ' ').replace(/_/g, ' '),
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { resource_type: 'invitation', resource_id: invitation.id },
    }
  }

  /**
   * Close a pending invitation and audit why. A replacement and a delivery
   * failure both revoke first, so the state change is written in one place.
   */
  private async revokePending(
    db: DatabaseQuery,
    invitation: Invitation,
    context: AdminRequestContext,
    ignoreMissing = false,
  ): Promise<void> {
    const revoked = await this.dependencies.invitations.revokePending(invitation.id, this.clock(), db)
    if (!revoked) {
      if (ignoreMissing) return
      throw conflict('Invitation is no longer pending.')
    }
    await this.dependencies.audit.write(this.change(invitation, 'invitation.revoked', context), db)
  }

  private requireManage(
    actorId: string,
    target: { organisationId: string; hospitalId: string | null },
  ): Promise<void> {
    return requireAdminPermission(this.dependencies.authorization, actorId, 'membership.manage', target)
  }

  private async requireNoMembership(
    userId: string,
    target: { organisationId: string; hospitalId: string | null },
  ): Promise<void> {
    const membership = await this.dependencies.memberships.findActiveMembershipForUser({
      userId,
      organisationId: target.organisationId,
      hospitalId: target.hospitalId,
    })
    if (membership !== null) throw conflict('This person already has access.')
  }

  private async validateRoles(
    organisationId: string,
    hospitalId: string | null,
    roleIds: readonly string[],
  ): Promise<OrganisationRole[]> {
    if (roleIds.length === 0) {
      throw new AppError('RULE_VIOLATION', 422, 'At least one role is required.')
    }
    const available = new Map(
      (await this.dependencies.memberships.findRoles(organisationId, roleIds)).map((role) => [role.id, role]),
    )
    const expectedScope = hospitalId === null ? 'organisation' : 'hospital'
    return roleIds.map((roleId) => {
      const role = available.get(roleId)
      if (role === undefined) {
        throw new AppError('RULE_VIOLATION', 422, 'Role is not available in this organisation.')
      }
      if (role.scope !== expectedScope) {
        throw new AppError('RULE_VIOLATION', 422, 'Role scope does not match the invitation.')
      }
      return role
    })
  }
}
