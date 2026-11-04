import type { Pool } from 'pg'
import { AppError } from '../shared/errors'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import { asAdminError } from './admin-errors'
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
  ): Promise<MembershipSummary[]> {
    await this.requireManage(context, input.organisationId, input.hospitalId ?? null)
    return this.memberships.list(input)
  }

  async listRoles(
    context: AdminRequestContext,
    organisationId: string,
  ): Promise<OrganisationRole[]> {
    await this.requireManage(context, organisationId, null)
    return this.memberships.listRoles(organisationId)
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
    const role = await this.memberships.findRole(membership.organisationId, roleId)
    if (role === null) throw new AppError('ROLE_NOT_FOUND', 422, 'Role is not available.')
    if (membership.hospitalId === null && role.scope !== 'organisation') {
      throw new AppError('ROLE_SCOPE_MISMATCH', 422, 'Role scope does not match the membership.')
    }
    if (membership.hospitalId !== null && role.scope !== 'hospital') {
      throw new AppError('ROLE_SCOPE_MISMATCH', 422, 'Role scope does not match the membership.')
    }
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
    const role = await this.memberships.findRole(membership.organisationId, roleId)
    if (role === null) throw new AppError('ROLE_NOT_FOUND', 422, 'Role is not available.')
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
    if (membership === null) throw notFound()
    await this.requireManage(context, membership.organisationId, membership.hospitalId)
    return membership
  }

  private async requireManage(
    context: AdminRequestContext,
    organisationId: string,
    hospitalId: string | null,
  ): Promise<void> {
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'membership.manage', {
        organisationId,
        hospitalId,
      }))
    if (!allowed) throw forbidden()
  }

  private async preventEscalation(
    context: AdminRequestContext,
    membership: MembershipSummary,
    role: OrganisationRole,
  ): Promise<void> {
    if (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) return
    const held = new Set(
      await this.authorization.listPermissions(context.actor.id, {
        organisationId: membership.organisationId,
        hospitalId: membership.hospitalId,
      }),
    )
    if (role.permissions.some((permission) => !held.has(permission))) {
      throw new AppError('PERMISSION_ESCALATION', 403, 'You cannot grant a role above your own rights.')
    }
  }

  private async protectLastOrganisationAdmin(membership: MembershipSummary): Promise<void> {
    if (membership.hospitalId !== null) return
    const count = await this.memberships.countActiveOrganisationAdmins(membership.organisationId)
    if (count <= 1) {
      throw new AppError('LAST_ORGANISATION_ADMIN', 409, 'The last organisation administrator cannot be removed.')
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
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: membership.organisationId,
      hospitalId: membership.hospitalId,
      eventType: 'membership.change',
      outcome: 'success',
      targetType: 'membership',
      targetId: membership.id,
      requestId: context.requestId,
      reason,
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: {
        membership_id: membership.id,
        from_status: fromStatus,
        to_status: toStatus,
      },
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
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId: membership.organisationId,
      hospitalId: membership.hospitalId,
      eventType: 'role.assign',
      outcome: 'success',
      targetType: 'membership',
      targetId: membership.id,
      requestId: context.requestId,
      reason: reasonCode === 'role.assigned' ? 'role assigned' : 'role revoked',
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { membership_id: membership.id, role_id: roleId },
    }, db)
  }
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'Membership not found.')
}

function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message)
}
