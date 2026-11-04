import { createAccessRepository, type MembershipAccess } from '../../repositories/access-repository'
import { clockOf, type AuthDependencies } from './dependencies'
import { authenticateRequest } from './session'

export interface SessionDto {
  user: {
    id: string
    email: string
    displayName: string
  }
  memberships: MembershipDto[]
  permissions: string[]
}

export interface MembershipDto {
  id: string
  organisationId: string
  organisationName: string
  hospitalId: string | null
  hospitalName: string | null
  startsAt: string
  endsAt: string | null
  roles: string[]
}

/**
 * Read what the current bearer session may see. The memberships and
 * permissions are informational; a protected route resolves access again.
 */
export async function readSession(
  dependencies: AuthDependencies,
  authorization: string | null | undefined,
): Promise<SessionDto> {
  const { user } = await authenticateRequest(dependencies, authorization)
  const access = await createAccessRepository(dependencies.db).listForUser(
    user.id,
    clockOf(dependencies)(),
  )

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    memberships: access.memberships.map(membershipDto),
    permissions: [...access.permissions],
  }
}

function membershipDto(membership: MembershipAccess): MembershipDto {
  return {
    id: membership.id,
    organisationId: membership.organisationId,
    organisationName: membership.organisationName,
    hospitalId: membership.hospitalId,
    hospitalName: membership.hospitalName,
    startsAt: membership.startsAt.toISOString(),
    endsAt: membership.endsAt?.toISOString() ?? null,
    roles: [...membership.roles],
  }
}
