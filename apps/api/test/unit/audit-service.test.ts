import { describe, expect, test } from 'bun:test'
import { createAuditAdmin } from '../../src/admin/audit/service'
import type { AuditEntry } from '../../src/admin/audit/store'
import { AppError } from '../../src/shared/errors'

const input = { organisationId: 'org-1', hospitalId: null, limit: 10 }

const entry: AuditEntry = {
  id: '7',
  cursor: '2026-11-04T16:25:51.742539Z:7',
  occurredAt: new Date('2026-11-04T16:25:51.742Z'),
  actorType: 'user',
  actorUserId: 'user-1',
  sessionId: 'session-1',
  organisationId: 'org-1',
  hospitalId: null,
  eventType: 'admin.change',
  outcome: 'success',
  targetType: null,
  targetId: null,
  requestId: null,
  reasonCode: 'hospital.create',
  metadata: {},
}

describe('audit admin', () => {
  test('authorises at the requested scope, then reads', async () => {
    const checks: unknown[] = []
    const admin = createAuditAdmin({
      store: { list: async () => [entry] },
      authorize: async (actorId, permission, target) => {
        checks.push({ actorId, permission, target })
      },
    })

    await expect(admin.list('actor-1', input)).resolves.toEqual([entry])
    expect(checks).toEqual([
      { actorId: 'actor-1', permission: 'audit.read', target: { organisationId: 'org-1', hospitalId: null } },
    ])
  })

  test('a denied read never reaches storage', async () => {
    let reads = 0
    const admin = createAuditAdmin({
      store: {
        list: async () => {
          reads += 1
          return [entry]
        },
      },
      authorize: async () => {
        throw new AppError('FORBIDDEN', 403, 'Not allowed.')
      },
    })

    try {
      await admin.list('actor-1', input)
      throw new Error('expected the read to be denied')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    }
    expect(reads).toBe(0)
  })
})
