import { describe, expect, test } from 'bun:test'

import { createMetrics } from '../../src/shared/metrics'

function line(attributes: Record<string, string | number>): string {
  const lines: string[] = []
  const metrics = createMetrics((value) => lines.push(value))
  metrics.count('auth.login_failed', attributes)
  return lines[0] ?? ''
}

describe('metrics', () => {
  test('writes one JSON object with a fixed name', () => {
    const value = line({ reason: 'invalid_attempt', duration_ms: 12 })

    expect(JSON.parse(value)).toEqual({
      metric: 'auth.login_failed',
      reason: 'invalid_attempt',
      duration_ms: 12,
    })
  })

  test('drops identifiers, tokens and free text', () => {
    const value = line({
      reason: 'invalid_attempt',
      email: 'doctor@example.test',
      token: 'a'.repeat(43),
      displayName: 'Dev Doctor',
    })

    expect(value).not.toContain('@')
    expect(value).not.toContain('a'.repeat(43))
    expect(value).not.toContain('Dev Doctor')
    expect(JSON.parse(value)).toEqual({
      metric: 'auth.login_failed',
      reason: 'invalid_attempt',
    })
  })

  test('drops numbers that cannot be a counter value', () => {
    const lines: string[] = []
    const metrics = createMetrics((value) => lines.push(value))

    metrics.count('admin.provisioning_lag', {
      duration_ms: Number.POSITIVE_INFINITY,
    })
    metrics.count('admin.provisioning_lag', { duration_ms: -1 })

    expect(lines).toEqual([
      '{"metric":"admin.provisioning_lag"}',
      '{"metric":"admin.provisioning_lag"}',
    ])
  })
})
