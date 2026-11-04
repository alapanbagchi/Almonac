import type { Pool } from 'pg'
import { conflict, forbidden, notFound, ruleViolation } from '../shared/errors'
import { asAdminError } from './admin-errors'
import type { Page, PageRequest } from '../shared/pagination'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import { isPlatformAdmin, requireAdminPermission } from './admin-authorization'
import type { AuditSink } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AdminRequestContext } from './admin-context'
import { recordAdminChange } from './admin-audit'
import {
  MembershipAdminRepository,
  type MembershipSummary,
  type OrganisationRole,
} from './membership-admin-repository'

/** Where a membership lives: the shape the permission check needs. */
type Scope = { organisationId: string; hospitalId: string | null }

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
    await this.requireManage(context, {
      organisationId: input.organisationId,
      hospitalId: input.hospitalId ?? null,
    })
    return this.memberships.list(input, page)
  }

  async listRoles(
    context: AdminRequestContext,
    organisationId: string,
    page: PageRequest,
  ): Promise<Page<OrganisationRole>> {
    await this.requireManage(context, { organisationId, hospitalId: null })
    return this.memberships.listRoles(organisationId, page)
  }

  async suspend(context: AdminRequestContext, membershipId: string, reason: string): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    if (membership.userId === context.actor.id) throw conflict('You cannot suspend your own access.')
    await withTransaction(this.pool, async (db) => {
      const suspended = await this.memberships.suspend(membership.id, new Date(), db)
      if (!suspended) throw conflict('Membership is not active.')
      await this.change(context, db, membership, 'membership.suspended', reason, {
        from_status: 'active',
        to_status: 'suspended',
      })
    })
  }

  async revoke(context: AdminRequestContext, membershipId: string, reason: string): Promise<void> {
    const membership = await this.requireMembership(context, membershipId)
    if (membership.userId === context.actor.id) throw conflict('You cannot revoke your own access.')
    await this.protectLastOrganisationAdmin(membership)
    await withTransaction(this.pool, async (db) => {
      const revoked = await this.memberships.revoke(
        { id: membership.id, at: new Date(), revokedBy: context.actor.id, reason },
        db,
      )
      if (!revoked) throw conflict('Membership cannot be revoked.')
      await this.change(context, db, membership, 'membership.revoked', reason, {
        from_status: membership.status,
        to_status: 'revoked',
      })
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
      await this.changeRole(context, db, membership, role.id, 'role.assigned')
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
      await this.changeRole(context, db, membership, role.id, 'role.revoked')
    })
  }

  private async requireMembership(
    context: AdminRequestContext,
    membershipId: string,
  ): Promise<MembershipSummary> {
    const membership = await this.memberships.findById(membershipId)
    if (membership === null) throw notFound('Membership not found.')
    await this.requireManage(context, membership)
    return membership
  }

  /** The role must exist in the organisation and match the membership's scope. */
  private async assignableRole(
    membership: MembershipSummary,
    roleId: string,
  ): Promise<OrganisationRole> {
    const role = await this.memberships.findRole(membership.organisationId, roleId)
    if (role === null) throw ruleViolation('Role is not available.')
    const expected = membership.hospitalId === null ? 'organisation' : 'hospital'
    if (role.scope !== expected) throw ruleViolation('Role scope does not match the membership.')
    return role
  }

  private requireManage(context: AdminRequestContext, scope: Scope): Promise<void> {
    return requireAdminPermission(this.authorization, context.actor.id, 'membership.manage', scope)
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
      throw forbidden()
    }
  }

  private async protectLastOrganisationAdmin(membership: MembershipSummary): Promise<void> {
    if (membership.hospitalId !== null) return
    const count = await this.memberships.countActiveOrganisationAdmins(membership.organisationId)
    if (count <= 1) throw conflict('The last organisation administrator cannot be removed.')
  }

  private change(
    context: AdminRequestContext,
    db: DatabaseQuery,
    membership: MembershipSummary,
    reasonCode: string,
    reason: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    return this.record(context, db, membership, reasonCode, {
      eventType: 'membership.change',
      reason,
      metadata: { membership_id: membership.id, ...metadata },
    })
  }

  private changeRole(
    context: AdminRequestContext,
    db: DatabaseQuery,
    membership: MembershipSummary,
    roleId: string,
    reasonCode: string,
  ): Promise<void> {
    return this.record(context, db, membership, reasonCode, {
      eventType: 'role.assign',
      metadata: { membership_id: membership.id, role_id: roleId },
    })
  }

  private record(
    context: AdminRequestContext,
    db: DatabaseQuery,
    membership: MembershipSummary,
    reasonCode: string,
    options: Parameters<typeof recordAdminChange>[5],
  ): Promise<void> {
    return recordAdminChange(
      this.audit,
      context,
      { targetType: 'membership', targetId: membership.id, ...membership },
      reasonCode,
      db,
      options,
    )
  }
}
