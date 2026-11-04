import { describe, expect, test } from 'bun:test'
import type { OrganisationRole } from '../../src/repositories/role-repository'
import type { AppUser } from '../../src/repositories/app-user-repository'
import {
  assertInvitationAcceptable,
  draftOf,
  matchRoles,
} from '../../src/controllers/admin/invitations/issue'
import { invitationResponse } from '../../src/controllers/admin/invitations/responses'
import type { Invitation } from '../../src/repositories/invitation-repository'
import { AppError } from '../../src/shared/errors'

const ROLE: OrganisationRole = {
  id: '44444444-4444-4444-8444-444444444444',
  key: 'member',
  name: 'Member',
  scope: 'organisation',
  permissions: ['organisation.read'],
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'person@example.com',
    organisationId: '22222222-2222-4222-8222-222222222222',
    hospitalId: null,
    kind: 'new_user',
    zitadelSub: 'subject-1',
    status: 'pending',
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    acceptedAt: null,
    acceptedByUserId: null,
    invitedBy: '33333333-3333-4333-8333-333333333333',
    roleIds: [ROLE.id],
    ...overrides,
  }
}

function actor(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    identityIssuer: 'https://issuer.example',
    zitadelSubject: 'subject-1',
    email: 'person@example.com',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayName: 'Person',
    homeOrganisationId: null,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: null,
    ...overrides,
  }
}

async function failure(run: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(run)
    .then(() => null, (error: unknown) => error)
}

describe('invitation rules', () => {
  test('returns roles in the requested order', () => {
    const other: OrganisationRole = { ...ROLE, id: '77777777-7777-4777-8777-777777777777' }

    expect(matchRoles([ROLE, other], [other.id, ROLE.id], 'organisation')).toEqual([
      other.id,
      ROLE.id,
    ])
  })

  test('rejects a role outside the organisation and a role of the wrong scope', async () => {
    const missing = await failure(() =>
      matchRoles([ROLE], ['88888888-8888-4888-8888-888888888888'], 'organisation'),
    )
    const wrongScope = await failure(() => matchRoles([ROLE], [ROLE.id], 'hospital'))

    expect(missing).toBeInstanceOf(AppError)
    expect(missing).toMatchObject({
      status: 422,
      message: 'Role is not available in this organisation.',
    })
    expect(wrongScope).toMatchObject({
      status: 422,
      message: 'Role scope does not match the invitation.',
    })
  })

  test('accepts a pending invitation from the named identity', () => {
    expect(() =>
      assertInvitationAcceptable(invitation(), actor(), new Date('2026-01-02T00:00:00.000Z')),
    ).not.toThrow()
  })

  test('refuses an accepted invitation, an expired one and another identity', async () => {
    const accepted = await failure(() =>
      assertInvitationAcceptable(
        invitation({ status: 'accepted' }),
        actor(),
        new Date('2026-01-02T00:00:00.000Z'),
      ),
    )
    const expired = await failure(() =>
      assertInvitationAcceptable(invitation(), actor(), new Date('2026-02-01T00:00:00.000Z')),
    )
    const otherIdentity = await failure(() =>
      assertInvitationAcceptable(
        invitation(),
        actor({ zitadelSubject: 'subject-2' }),
        new Date('2026-01-02T00:00:00.000Z'),
      ),
    )

    expect(accepted).toBeInstanceOf(AppError)
    expect(accepted).toMatchObject({ code: 'CONFLICT', message: 'Invitation is no longer pending.' })
    expect(expired).toMatchObject({ message: 'Invitation has expired.' })
    expect(otherIdentity).toMatchObject({ status: 403 })
  })

  test('keeps the invitation fields when a link is reissued', () => {
    const draft = draftOf(invitation())

    expect(draft).toMatchObject({
      email: 'person@example.com',
      organisationId: '22222222-2222-4222-8222-222222222222',
      kind: 'new_user',
      zitadelSub: 'subject-1',
      roleIds: [ROLE.id],
    })
  })

  test('publishes instants and copies the role list', () => {
    const response = invitationResponse(invitation())

    expect(response).toMatchObject({
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      acceptedAt: null,
      roleIds: [ROLE.id],
    })
    expect(response.roleIds).not.toBe(invitation().roleIds)
  })
})
