import { describe, expect, test } from 'bun:test'
import { requireAssurance } from '../../src/guards/assurance'

const NOW = new Date('2026-01-01T10:00:00.000Z')

function session(overrides: {
  aal?: number
  amr?: string[]
  authTime?: Date
} = {}) {
  return {
    aal: overrides.aal ?? 2,
    amr: overrides.amr ?? ['pwd', 'otp'],
    authTime: overrides.authTime ?? new Date(NOW.getTime() - 60_000),
  }
}

describe('assurance policy', () => {
  test('accepts a session at or above the required level', () => {
    expect(() =>
      requireAssurance(session({ aal: 2 }), { minimumAal: 2 }, NOW),
    ).not.toThrow()
    expect(() =>
      requireAssurance(session({ aal: 3 }), { minimumAal: 2 }, NOW),
    ).not.toThrow()
  })

  test('rejects a weaker session with a step-up error', () => {
    expect(() =>
      requireAssurance(session({ aal: 1 }), { minimumAal: 2 }, NOW),
    ).toThrow(expect.objectContaining({ code: 'STEP_UP_REQUIRED', status: 403 }))
  })

  test('rejects an authentication older than the policy window', () => {
    expect(() =>
      requireAssurance(
        session({ authTime: new Date(NOW.getTime() - 10 * 60_000) }),
        { minimumAal: 2, maxAuthAgeSeconds: 300 },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: 'STEP_UP_REQUIRED' }))

    expect(() =>
      requireAssurance(
        session({ authTime: new Date(NOW.getTime() - 5 * 60_000) }),
        { minimumAal: 2, maxAuthAgeSeconds: 300 },
        NOW,
      ),
    ).not.toThrow()
  })

  test('requires every configured authentication method', () => {
    expect(() =>
      requireAssurance(session({ amr: ['pwd'] }), {
        minimumAal: 2,
        requiredAmr: ['otp'],
      }, NOW),
    ).toThrow(expect.objectContaining({ code: 'STEP_UP_REQUIRED' }))

    expect(() =>
      requireAssurance(session({ amr: ['pwd', 'otp'] }), {
        minimumAal: 2,
        requiredAmr: ['otp'],
      }, NOW),
    ).not.toThrow()
  })

  test('rejects an invalid age window', () => {
    expect(() =>
      requireAssurance(session(), { minimumAal: 1, maxAuthAgeSeconds: -1 }, NOW),
    ).toThrow('maxAuthAgeSeconds must be a non-negative integer')
  })
})
