import { describe, expect, test } from 'bun:test'
import type { DatabaseQuery } from '../../src/db/pool'
import {
  createInvitationRepository,
  type Invitation,
} from '../../src/repositories/invitation-repository'
import { ConflictError } from '../../src/shared/errors'

interface QueryCall {
  readonly text: string
  readonly values: readonly unknown[]
}

function recordingDatabase(
  responses: readonly { rows: readonly unknown[] }[],
): { db: DatabaseQuery; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  const queue = [...responses]
  return {
    calls,
    db: {
      async query(text, values) {
        calls.push({ text, values: values ?? [] })
        return queue.shift() ?? { rows: [] }
      },
    },
  }
}

function invitationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'person@example.com',
    organisation_id: '22222222-2222-4222-8222-222222222222',
    hospital_id: null,
    kind: 'new_user',
    zitadel_sub: 'subject-1',
    status: 'pending',
    expires_at: new Date('2026-01-08T00:00:00.000Z'),
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    accepted_at: null,
    accepted_by_user_id: null,
    invited_by: '33333333-3333-4333-8333-333333333333',
    role_ids: ['44444444-4444-4444-8444-444444444444'],
    ...overrides,
  }
}

const ROLE_ID = '55555555-5555-4555-8555-555555555555'

describe('invitation repository', () => {
  test('creates the invitation and its roles, then maps the stored row', async () => {
    const { db, calls } = recordingDatabase([
      { rows: [invitationRow()] },
      { rows: [] },
    ])
    const repository = createInvitationRepository(db)

    const invitation = await repository.create({
      email: 'person@example.com',
      organisationId: '22222222-2222-4222-8222-222222222222',
      hospitalId: null,
      kind: 'new_user',
      zitadelSub: 'subject-1',
      tokenHash: Buffer.alloc(32),
      invitedBy: '33333333-3333-4333-8333-333333333333',
      expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      roleIds: [ROLE_ID],
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.text).toContain('insert into identity.invitation')
    expect(calls[1]?.text).toContain('insert into control.invitation_role')
    expect(calls[1]?.values).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      [ROLE_ID],
    ])
    expect(invitation).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'person@example.com',
      kind: 'new_user',
      zitadelSub: 'subject-1',
      status: 'pending',
      roleIds: [ROLE_ID],
    })
    expect(invitation.expiresAt).toBeInstanceOf(Date)
  })

  test('reports a concurrent pending invitation as a conflict', async () => {
    const db: DatabaseQuery = {
      async query() {
        throw Object.assign(new Error('exclusion constraint'), { code: '23P01' })
      },
    }

    const failure = await createInvitationRepository(db)
      .create({
        email: 'person@example.com',
        organisationId: '22222222-2222-4222-8222-222222222222',
        hospitalId: null,
        kind: 'new_user',
        zitadelSub: null,
        tokenHash: Buffer.alloc(32),
        invitedBy: '33333333-3333-4333-8333-333333333333',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        roleIds: [ROLE_ID],
      })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictError)
    expect(failure).toMatchObject({
      message: 'An invitation is already pending for this person.',
    })
  })

  test('reports a reused token hash as a conflict', async () => {
    const db: DatabaseQuery = {
      async query() {
        throw Object.assign(new Error('unique violation'), { code: '23505' })
      },
    }

    const failure = await createInvitationRepository(db)
      .create({
        email: 'person@example.com',
        organisationId: '22222222-2222-4222-8222-222222222222',
        hospitalId: null,
        kind: 'existing_user',
        zitadelSub: 'subject-1',
        tokenHash: Buffer.alloc(32),
        invitedBy: '33333333-3333-4333-8333-333333333333',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        roleIds: [ROLE_ID],
      })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictError)
    expect(failure).toMatchObject({ message: 'The invitation token is already in use.' })
  })

  test('lists one row beyond the page and reports the next offset', async () => {
    const { db, calls } = recordingDatabase([
      {
        rows: [
          invitationRow({ id: 'a' }),
          invitationRow({ id: 'b' }),
          invitationRow({ id: 'c' }),
        ],
      },
    ])

    const page = await createInvitationRepository(db).list(
      { organisationId: '22222222-2222-4222-8222-222222222222', hospitalId: null },
      { limit: 2, offset: 4 },
    )

    expect(calls[0]?.values).toEqual([
      '22222222-2222-4222-8222-222222222222',
      null,
      3,
      4,
    ])
    expect(page.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(page.nextOffset).toBe(6)
  })

  test('returns null when no pending invitation matches the scope', async () => {
    const { db, calls } = recordingDatabase([{ rows: [] }])

    const invitation: Invitation | null = await createInvitationRepository(db).findPendingForScope({
      email: 'person@example.com',
      organisationId: '22222222-2222-4222-8222-222222222222',
      hospitalId: null,
    })

    expect(invitation).toBeNull()
    expect(calls[0]?.values).toEqual([
      'person@example.com',
      '22222222-2222-4222-8222-222222222222',
      null,
    ])
  })

  test('tells whether a pending invitation was actually revoked or accepted', async () => {
    const revoked = await createInvitationRepository(
      recordingDatabase([{ rows: [{ id: 'a' }] }]).db,
    ).revokePending('a', new Date())

    const missing = await createInvitationRepository(recordingDatabase([{ rows: [] }]).db)
      .markAccepted('a', { acceptedByUserId: 'user-1', at: new Date() })

    expect(revoked).toBe(true)
    expect(missing).toBe(false)
  })
})
