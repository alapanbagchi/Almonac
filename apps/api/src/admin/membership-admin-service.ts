import type { Pool } from 'pg'
import { AppError } from '../shared/errors'
import type { Page, PageRequest } from '../shared/pagination'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import { asAdminError, conflict, notFound } from './admin-errors'
import { isPlatformAdmin, requireAdminPermission } from './admin-authorization'
import type { AuditSink } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AdminRequestContext } from './admin-context'
import {
  MembershipAdminRepository,
  type MembershipSummary,
  type OrganisationRole,
} from './membership-admin-repository'

export class MembershipAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly memberships: MembershipAdminRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly audit: AuditSink,
  ) {}

  async list(
    context: AdminRequestContext,
    input: { organisationId: string; hospitalId?: string | null },
    page: PageRequest,
  ): Promise<Page<MembershipSummary>> {
    await this.requireManage(context, input.organisationId, input.hospitalId ?? null)
    return this.memberships.list(input, page)
  }

  async listRoles(
    context: AdminRequestContext,
    organisationId: string,
    page: PageRequest,
  ): Promise<Page<OrganisationRole>> {
    await this.requireManage(context, organisationId, null)
    return this.memberships.listRoles(organisationId, page)
  }

  async suspend(context: AdminRequestContext, membershipId: string, reason: string): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    if (membership.userId === context.actor.id) throw conflict('You cannot suspend your own access.')
    await withTransaction(this.pool, async (db) => {
      const changed = await this.memberships.suspend(membership.id, new Date(), db)
      if (!changed) throw conflict('Membership is not active.')
      await this.auditChange(context, membership, 'active', 'suspended', reason, 'membership.suspended', db)
    })
  }

  async revoke(context: AdminRequestContext, membershipId: string, reason: string): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    if (membership.userId === context.actor.id) throw conflict('You cannot revoke your own access.')
    await this.protectLastOrganisationAdmin(membership)
    await withTransaction(this.pool, async (db) => {
      const changed = await this.memberships.revoke(
        { id: membership.id, at: new Date(), revokedBy: context.actor.id, reason },
        db,
      )
      if (!changed) throw conflict('Membership cannot be revoked.')
      await this.auditChange(context, membership, membership.status, 'revoked', reason, 'membership.revoked', db)
    })
  }

  async assignRole(
    context: AdminRequestContext,
    membershipId: string,
    roleId: string,
  ): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    const role = await this.assignableRole(membership, roleId)
    await this.preventEscalation(context, membership, role)
    await withTransaction(this.pool, async (db) => {
      try {
        await this.memberships.assignRole(
          { membershipId, roleId, assignedBy: context.actor.id, at: new Date() },
          db,
        )
      } catch (error) {
        throw asAdminError(error)
      }
      await this.auditRole(context, membership, role.id, 'role.assigned', db)
    })
  }

  async revokeRole(
    context: AdminRequestContext,
    membershipId: string,
    roleId: string,
  ): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    const role = await this.assignableRole(membership, roleId)
    if (role.permissions.includes('organisation.manage') && membership.hospitalId === null) {
      await this.protectLastOrganisationAdmin(membership)
    }
    await withTransaction(this.pool, async (db) => {
      const revoked = await this.memberships.revokeRole(
        {
          membershipId,
          roleId,
          revokedBy: context.actor.id,
          at: new Date(),
          reason: 'role revoked by administrator',
        },
        db,
      )
      if (!revoked) throw conflict('Role assignment is not active.')
      await this.auditRole(context, membership, role.id, 'role.revoked', db)
    })
  }

  private async requireMembership(
    context: AdminRequestContext,
    membershipId: string,
  ): Promise<MembershipSummary> {
    const membership = await this.memberships.findById(membershipId)
    if (membership === null) throw notFound('Membership not found.')
    await this.requireManage(context, membership.organisationId, membership.hospitalId)
    return membership
  }

  /** The role must exist in the organisation and match the membership's scope. */
  private async assignableRole(
    membership: MembershipSummary,
    roleId: string,
  ): Promise<OrganisationRole> {
    const role = await this.memberships.findRole(membership.organisationId, roleId)
    if (role === null) throw new AppError('RULE_VIOLATION', 422, 'Role is not available.')
    const expectedScope = membership.hospitalId === null ? 'organisation' : 'hospital'
    if (role.scope !== expectedScope) {
      throw new AppError('RULE_VIOLATION', 422, 'Role scope does not match the membership.')
    }
    return role
  }

  private requireManage(
    context: AdminRequestContext,
    organisationId: string,
    hospitalId: string | null,
  ): Promise<void> {
    return requireAdminPermission(this.authorization, context.actor.id, 'membership.manage', {
      organisationId,
      hospitalId,
    })
  }

  private async preventEscalation(
    context: AdminRequestContext,
    membership: MembershipSummary,
    role: OrganisationRole,
  ): Promise<void> {
    if (await isPlatformAdmin(this.authorization, context.actor.id)) return
    const held = new Set(
      await this.authorization.listPermissions(context.actor.id, {
        organisationId: membership.organisationId,
        hospitalId: membership.hospitalId,
      }),
    )
    if (role.permissions.some((permission) => !held.has(permission))) {
      throw new AppError('FORBIDDEN', 403, 'You cannot grant a role above your own rights.')
    }
  }

  private async protectLastOrganisationAdmin(membership: MembershipSummary): Promise<void> {
    if (membership.hospitalId !== null) return
    const count = await this.memberships.countActiveOrganisationAdmins(membership.organisationId)
    if (count <= 1) {
      throw new AppError('CONFLICT', 409, 'The last organisation administrator cannot be removed.')
    }
  }

  /** Attribution every membership and role event carries: who, where, and from which request. */
  private attributed(context: AdminRequestContext, membership: MembershipSummary) {
    return {
      actorUserId: context.actor.id,
      actorType: 'user' as const,
      sessionId: context.sessionId,
      organisationId: membership.organisationId,
      hospitalId: membership.hospitalId,
      requestId: context.requestId,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
    }
  }

  private async auditChange(
    context: AdminRequestContext,
    membership: MembershipSummary,
    fromStatus: string,
    toStatus: string,
    reason: string,
    reasonCode: string,
    db?: DatabaseQuery,
  ): Promise<void> {
    await this.audit.write({
      ...this.attributed(context, membership),
      eventType: 'membership.change',
      outcome: 'success',
      targetType: 'membership',
      targetId: membership.id,
      reason,
      reasonCode,
      metadata: { membership_id: membership.id, from_status: fromStatus, to_status: toStatus },
    }, db)
  }

  private async auditRole(
    context: AdminRequestContext,
    membership: MembershipSummary,
    roleId: string,
    reasonCode: string,
    db?: DatabaseQuery,
  ): Promise<void> {
    await this.audit.write({
      ...this.attributed(context, membership),
      eventType: 'role.assign',
      outcome: 'success',
      targetType: 'membership',
      targetId: membership.id,
      reason: reasonCode === 'role.assigned' ? 'role assigned' : 'role revoked',
      reasonCode,
      metadata: { membership_id: membership.id, role_id: roleId },
    }, db)
  }
}
