import { requireAdminPermission } from './admin-authorization'
import { forbidden } from '../shared/errors'
import {
  INVITATION_TTL_MS,
  type InvitationDelivery,
  type InvitationServiceDependencies,
} from './invitation-types'
import type { Invitation } from './invitation-repository'
import type { OrganisationRole } from './membership-admin-repository'
import { conflict, notFound, ruleViolation } from '../shared/errors'
import type { Page, PageRequest } from '../shared/pagination'
import { normaliseEmail } from '../shared/email'
import { hashToken, mintToken } from '../shared/tokens'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import type { AdminRequestContext } from './admin-context'
import { recordAdminChange } from './admin-audit'

/** What an issue writes, and the only time the raw token exists. */
interface InvitationIssue {
  readonly invitation: Invitation
  readonly token: string
}

/** The row an invitation is written from. */
interface InvitationDraft {
  readonly actorId: string
  readonly email: string
  readonly kind: Invitation['kind']
  readonly zitadelSub: string | null
  readonly organisationId: string
  readonly hospitalId: string | null
  readonly roleIds: readonly string[]
}

type Scope = { organisationId: string; hospitalId: string | null }

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
    if (email === null) throw ruleViolation('Email address is not valid.')
    const { scope, delivery } = await this.scopeOf(input.organisationId, input.hospitalId ?? null)
    await this.requireManage(context, scope)
    await this.validateRoles(scope, input.roleIds)

    const pending = await this.dependencies.invitations.findPendingForScope({ email, ...scope })
    if (pending !== null) return this.replace(context, pending, delivery)

    const existing = await this.dependencies.users.findByEmail(email)
    if (existing !== null) {
      if (existing.status !== 'active') throw conflict('This identity is not active.')
      await this.requireNoMembership(existing.id, scope)
      return this.issueAndDeliver(
        context,
        {
          actorId: context.actor.id,
          email,
          kind: 'existing_user',
          zitadelSub: existing.zitadelSubject,
          ...scope,
          roleIds: input.roleIds,
        },
        delivery,
      )
    }

    const organisation = await this.dependencies.organisations.findById(scope.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    // A new account is created in the organisation's Zitadel tenant, so it
    // must exist before an invitation can name one.
    if (organisation.zitadelOrgId === null) {
      throw ruleViolation('The organisation is not provisioned yet.')
    }
    const displayName = input.displayName?.trim() || email.split('@')[0] || email
    const subject = await this.dependencies.zitadel.createHumanUser(organisation.zitadelOrgId, {
      email,
      displayName,
    })
    try {
      return await this.issueAndDeliver(
        context,
        {
          actorId: context.actor.id,
          email,
          kind: 'new_user',
          zitadelSub: subject,
          ...scope,
          roleIds: input.roleIds,
        },
        delivery,
      )
    } catch (error) {
      // The account was created for an invitation that never went out; it
      // stays disabled on the provider side, so disable it explicitly.
      await this.dependencies.zitadel
        .deactivateUser(organisation.zitadelOrgId, subject)
        .catch(() => undefined)
      throw error
    }
  }

  async list(
    context: AdminRequestContext,
    input: { organisationId: string; hospitalId?: string | null },
    page: PageRequest,
  ): Promise<Page<Invitation>> {
    await this.requireManage(context, {
      organisationId: input.organisationId,
      hospitalId: input.hospitalId ?? null,
    })
    return this.dependencies.invitations.list(input, page)
  }

  async resend(context: AdminRequestContext, invitationId: string): Promise<Invitation> {
    const invitation = await this.requireInvitation(context, invitationId)
    if (invitation.status !== 'pending' || invitation.expiresAt <= this.now()) {
      throw conflict('Invitation is no longer pending.')
    }
    return this.replace(context, invitation, await this.delivery(invitation))
  }

  async revoke(context: AdminRequestContext, invitationId: string): Promise<void> {
    const invitation = await this.requireInvitation(context, invitationId)
    await withTransaction(this.dependencies.pool, (db) =>
      this.revokePending(db, invitation, context),
    )
  }

  async accept(context: AdminRequestContext, token: string): Promise<Invitation> {
    const user = context.actor
    return withTransaction(this.dependencies.pool, async (db) => {
      const invitation = await this.dependencies.invitations.findByTokenHashForUpdate(db, hashToken(token))
      if (invitation === null) throw notFound('Invitation not found.')
      if (invitation.status !== 'pending') throw conflict('Invitation is no longer pending.')
      const now = this.now()
      // An elapsed invitation and a revoked one are the same state to the
      // invitee: the link no longer works and someone must issue a new one.
      if (invitation.expiresAt <= now) throw conflict('Invitation has expired.')
      if (invitation.zitadelSub !== null && invitation.zitadelSub !== user.zitadelSubject) {
        throw forbidden()
      }
      await this.requireNoMembership(user.id, invitation)

      await this.dependencies.memberships.createFromInvitation(
        {
          userId: user.id,
          organisationId: invitation.organisationId,
          hospitalId: invitation.hospitalId,
          roleIds: invitation.roleIds,
          assignedBy: invitation.invitedBy,
        },
        db,
      )
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

  private now(): Date {
    return this.dependencies.clock?.() ?? new Date()
  }

  /** An invitation names an organisation and, optionally, one of its hospitals. */
  private async scopeOf(
    organisationId: string,
    hospitalId: string | null,
  ): Promise<{ scope: Scope; delivery: InvitationDelivery }> {
    const organisation = await this.dependencies.organisations.findById(organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    if (hospitalId === null) {
      return {
        scope: { organisationId: organisation.id, hospitalId },
        delivery: { organisationName: organisation.name, hospitalName: null },
      }
    }
    const hospital = await this.dependencies.hospitals.findById(hospitalId)
    if (hospital?.organisationId !== organisation.id) throw notFound('Hospital not found.')
    return {
      scope: { organisationId: organisation.id, hospitalId },
      delivery: { organisationName: organisation.name, hospitalName: hospital.name },
    }
  }

  /** The names the mail names, for an invitation that already exists. */
  private async delivery(scope: Scope): Promise<InvitationDelivery> {
    const organisation = await this.dependencies.organisations.findById(scope.organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const hospital =
      scope.hospitalId === null ? null : await this.dependencies.hospitals.findById(scope.hospitalId)
    return { organisationName: organisation.name, hospitalName: hospital?.name ?? null }
  }

  private async issueAndDeliver(
    context: AdminRequestContext,
    draft: InvitationDraft,
    delivery: InvitationDelivery,
  ): Promise<Invitation> {
    const issued = await withTransaction(this.dependencies.pool, async (db) => {
      const minted = mintToken()
      const invitation = await this.dependencies.invitations.create(
        {
          ...draft,
          tokenHash: minted.tokenHash,
          invitedBy: draft.actorId,
          expiresAt: new Date(this.now().getTime() + INVITATION_TTL_MS),
        },
        db,
      )
      await this.audit(context, db, invitation, 'invitation.created')
      return { invitation, token: minted.token }
    })
    await this.deliver(context, issued, delivery)
    return issued.invitation
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
      // Keep the delivery failure. An unrevoked invitation still expires.
      await withTransaction(this.dependencies.pool, (db) =>
        this.revokePending(db, issued.invitation, context, true),
      ).catch(() => undefined)
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
      if (organisation?.zitadelOrgId != null) {
        await this.dependencies.zitadel.resendInitialization(
          organisation.zitadelOrgId,
          invitation.zitadelSub,
        )
      }
    }
    const issued = await withTransaction(this.dependencies.pool, async (db) => {
      await this.revokePending(db, invitation, context)
      const minted = mintToken()
      const created = await this.dependencies.invitations.create(
        {
          email: invitation.email,
          organisationId: invitation.organisationId,
          hospitalId: invitation.hospitalId,
          kind: invitation.kind,
          zitadelSub: invitation.zitadelSub,
          tokenHash: minted.tokenHash,
          invitedBy: context.actor.id,
          expiresAt: new Date(this.now().getTime() + INVITATION_TTL_MS),
          roleIds: invitation.roleIds,
        },
        db,
      )
      await this.audit(context, db, created, 'invitation.resend')
      return { invitation: created, token: minted.token }
    })
    await this.deliver(context, issued, delivery)
    return issued.invitation
  }

  /** Close a pending invitation and audit why; a replacement and a delivery failure both do this. */
  private async revokePending(
    db: DatabaseQuery,
    invitation: Invitation,
    context: AdminRequestContext,
    ignoreMissing = false,
  ): Promise<void> {
    const revoked = await this.dependencies.invitations.revokePending(invitation.id, this.now(), db)
    if (!revoked) {
      if (ignoreMissing) return
      throw conflict('Invitation is no longer pending.')
    }
    await this.audit(context, db, invitation, 'invitation.revoked')
  }

  private audit(
    context: AdminRequestContext,
    db: DatabaseQuery,
    invitation: Invitation,
    reasonCode: string,
  ): Promise<void> {
    return recordAdminChange(
      this.dependencies.audit,
      context,
      {
        targetType: 'invitation',
        targetId: invitation.id,
        organisationId: invitation.organisationId,
        hospitalId: invitation.hospitalId,
      },
      reasonCode,
      db,
    )
  }

  private async requireInvitation(context: AdminRequestContext, invitationId: string): Promise<Invitation> {
    const invitation = await this.dependencies.invitations.findById(invitationId)
    if (invitation === null) throw notFound('Invitation not found.')
    await this.requireManage(context, invitation)
    return invitation
  }

  private requireManage(context: AdminRequestContext, scope: Scope): Promise<void> {
    return requireAdminPermission(
      this.dependencies.authorization,
      context.actor.id,
      'membership.manage',
      scope,
    )
  }

  private async requireNoMembership(userId: string, scope: Scope): Promise<void> {
    const membership = await this.dependencies.memberships.findActiveMembershipForUser({
      userId,
      ...scope,
    })
    if (membership !== null) throw conflict('This person already has access.')
  }

  private async validateRoles(scope: Scope, roleIds: readonly string[]): Promise<OrganisationRole[]> {
    if (roleIds.length === 0) throw ruleViolation('At least one role is required.')
    const available = new Map(
      (await this.dependencies.memberships.findRoles(scope.organisationId, roleIds)).map((role) => [
        role.id,
        role,
      ]),
    )
    const expected = scope.hospitalId === null ? 'organisation' : 'hospital'
    return roleIds.map((roleId) => {
      const role = available.get(roleId)
      if (role === undefined) throw ruleViolation('Role is not available in this organisation.')
      if (role.scope !== expected) throw ruleViolation('Role scope does not match the invitation.')
      return role
    })
  }
}
