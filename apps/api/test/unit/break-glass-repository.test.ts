import { describe, expect, test } from 'bun:test'
import type { DatabaseQuery } from '../../src/db/pool'
import {
  createBreakGlassRepository,
  type NewBreakGlassGrant,
} from '../../src/repositories/break-glass-repository'

const GRANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const HOSPITAL_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const REVIEW_ID = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-11-05T10:00:00.000Z')
const ENDS_AT = new Date('2026-11-05T11:00:00.000Z')

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    organisation_id: ORG_ID,
    hospital_id: HOSPITAL_ID,
    user_id: USER_ID,
    approved_by: null,
    approval_mode: 'emergency',
    reason: 'Cardiac arrest',
    access_level: 'read_only',
    status: 'active',
    starts_at: NOW,
    ends_at: ENDS_AT,
    approved_at: NOW,
    activated_at: NOW,
    activated_by: USER_ID,
    revoked_at: null,
    expired_at: null,
    created_at: NOW,
    ...overrides,
  }
}

function reviewRow() {
  return {
    id: REVIEW_ID,
    grant_id: GRANT_ID,
    reviewer_id: USER_ID,
    reviewed_at: NOW,
    decision: 'upheld',
    notes: null,
  }
}

function fakeDatabase(respond: (text: string) => readonly unknown[]) {
  const calls: string[] = []
  const db: DatabaseQuery = {
    async query(text) {
      calls.push(text)
      return { rows: respond(text) }
    },
  }
  return { db, calls }
}

const newGrant: NewBreakGlassGrant = {
  organisationId: ORG_ID,
  hospitalId: HOSPITAL_ID,
  userId: USER_ID,
  approvedBy: null,
  approvalMode: 'emergency',
  reason: 'Cardiac arrest',
  status: 'active',
  startsAt: NOW,
  endsAt: ENDS_AT,
  activatedAt: NOW,
  activatedBy: USER_ID,
}

describe('break-glass repository', () => {
  test('maps a grant row to dates and a read-only access level', async () => {
    const { db } = fakeDatabase(() => [grantRow()])
    const grant = await createBreakGlassRepository(db).findById(GRANT_ID)

    expect(grant).not.toBeNull()
    expect(grant?.startsAt).toEqual(NOW)
    expect(grant?.endsAt).toEqual(ENDS_AT)
    expect(grant?.activatedAt).toEqual(NOW)
    expect(grant?.revokedAt).toBeNull()
    expect(grant?.accessLevel).toBe('read_only')
  })

  test('returns null when no grant matches', async () => {
    const { db } = fakeDatabase(() => [])
    await expect(createBreakGlassRepository(db).findById(GRANT_ID)).resolves.toBeNull()
  })

  test('translates an overlapping window into a conflict', async () => {
    const { db } = fakeDatabase(() => {
      throw Object.assign(new Error('conflicting key'), { code: '23P01' })
    })

    await expect(createBreakGlassRepository(db).create(newGrant)).rejects.toMatchObject({
      name: 'AppError',
      code: 'CONFLICT',
      status: 409,
    })
  })

  test('translates a duplicate review into a conflict', async () => {
    const { db } = fakeDatabase(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })

    await expect(
      createBreakGlassRepository(db).createReview({
        grantId: GRANT_ID,
        reviewerId: USER_ID,
        reviewedAt: NOW,
        decision: 'upheld',
        notes: null,
      }),
    ).rejects.toMatchObject({ name: 'AppError', code: 'CONFLICT', status: 409 })
  })

  test('maps a review row', async () => {
    const { db } = fakeDatabase(() => [reviewRow()])
    const review = await createBreakGlassRepository(db).createReview({
      grantId: GRANT_ID,
      reviewerId: USER_ID,
      reviewedAt: NOW,
      decision: 'upheld',
      notes: null,
    })

    expect(review).toMatchObject({ id: REVIEW_ID, decision: 'upheld', notes: null })
  })

  test('reads one row beyond the page and reports the next offset', async () => {
    const calls: unknown[][] = []
    const db: DatabaseQuery = {
      async query(_text, values) {
        calls.push(values ?? [])
        return { rows: [grantRow(), grantRow(), grantRow()] }
      },
    }

    const page = await createBreakGlassRepository(db).list(USER_ID, HOSPITAL_ID, {
      limit: 2,
      offset: 4,
    })

    expect(page.items).toHaveLength(2)
    expect(page.nextOffset).toBe(6)
    expect(calls[0]).toEqual([USER_ID, HOSPITAL_ID, 3, 4])
  })
})
