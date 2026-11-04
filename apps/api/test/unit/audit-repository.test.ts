import { describe, expect, test } from 'bun:test'
import type { DatabaseQuery } from '../../src/db/pool'
import { createAuditRepository } from '../../src/repositories/audit-repository'

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

function auditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '9',
    occurred_at: new Date('2026-11-04T16:25:51.742Z'),
    occurred_at_cursor: '2026-11-04T16:25:51.742539Z',
    actor_type: 'user',
    actor_user_id: null,
    session_id: null,
    organisation_id: '22222222-2222-4222-8222-222222222222',
    hospital_id: null,
    event_type: 'admin.change',
    outcome: 'success',
    target_type: 'invitation',
    target_id: '11111111-1111-4111-8111-111111111111',
    request_id: null,
    reason_code: 'invitation.revoked',
    metadata: { resource_id: '11111111-1111-4111-8111-111111111111' },
    ...overrides,
  }
}

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222'

describe('audit repository', () => {
  test('pages by the tuple cursor and returns the last row cursor', async () => {
    const { db, calls } = recordingDatabase([
      { rows: [auditRow(), auditRow({ id: '8', occurred_at_cursor: '2026-11-04T16:25:51.000000Z' })] },
    ])

    const page = await createAuditRepository(db).list({
      organisationId: ORGANISATION_ID,
      hospitalId: null,
      limit: 25,
      cursor: { occurredAt: '2026-11-05T00:00:00.000000Z', id: '77' },
    })

    expect(calls[0]?.text).toContain('(occurred_at, id) < ($3::timestamptz, $4::bigint)')
    expect(calls[0]?.values).toEqual([
      ORGANISATION_ID,
      null,
      '2026-11-05T00:00:00.000000Z',
      '77',
      25,
    ])
    expect(page.entries).toHaveLength(2)
    expect(page.entries[0]?.occurredAt).toBeInstanceOf(Date)
    expect(page.entries[0]?.metadata).toEqual({
      resource_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(page.nextCursor).toBe('2026-11-04T16:25:51.000000Z:8')
  })

  test('starts at the newest entry when no cursor is given', async () => {
    const { db, calls } = recordingDatabase([{ rows: [] }])

    const page = await createAuditRepository(db).list({
      organisationId: ORGANISATION_ID,
      limit: 50,
    })

    expect(calls[0]?.values).toEqual([ORGANISATION_ID, null, null, null, 50])
    expect(page).toEqual({ entries: [], nextCursor: null })
  })

  test('refuses metadata that is not a flat scalar object', async () => {
    const notAnObject = recordingDatabase([{ rows: [auditRow({ metadata: ['x'] })] }]).db
    const nested = recordingDatabase([{ rows: [auditRow({ metadata: { a: { b: 1 } } })] }]).db

    const first = await createAuditRepository(notAnObject)
      .list({ organisationId: ORGANISATION_ID, limit: 50 })
      .then(() => null, (error: unknown) => error)
    const second = await createAuditRepository(nested)
      .list({ organisationId: ORGANISATION_ID, limit: 50 })
      .then(() => null, (error: unknown) => error)

    expect(first).toBeInstanceOf(Error)
    expect(first).toMatchObject({ message: 'database field metadata is not an object' })
    expect(second).toMatchObject({ message: 'database field metadata has an unsupported value' })
  })
})
