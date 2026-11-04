import { describe, expect, test } from 'bun:test'
import { parseAuditCursor } from '../../src/admin/audit-cursor'
import { AppError } from '../../src/shared/errors'

const VALID = '2026-11-04T16:25:51.742539Z:42'

describe('audit cursor', () => {
  test('accepts an absent cursor', () => {
    expect(parseAuditCursor(undefined)).toBeNull()
  })

  test('keeps microsecond precision', () => {
    expect(parseAuditCursor(VALID)).toEqual({
      occurredAt: '2026-11-04T16:25:51.742539Z',
      id: '42',
    })
  })

  test.each([
    '',
    'not-a-cursor',
    '2026-11-04T16:25:51.742539Z',
    '2026-11-04T16:25:51.742539Z:',
    '2026-11-04T16:25:51.742539Z:0',
    '2026-11-04T16:25:51.742539Z:01',
    '2026-11-04T16:25:51.742539Z:1234567890123456789',
    '2026-11-04T16:25:51.742539:42',
    '2026-11-04T16:25:51Z:42',
    '2026-02-30T16:25:51.742539Z:42',
  ])('rejects %s', (value) => {
    try {
      parseAuditCursor(value)
      throw new Error('expected the cursor to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
  })
})
