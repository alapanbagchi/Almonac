import { describe, expect, test } from 'bun:test'
import {
  CONTROL_CONNECTION_TIMEOUT_MS,
  CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  CONTROL_IDLE_TIMEOUT_MS,
  CONTROL_POOL_MAX,
  CONTROL_RUNTIME_ROLE,
  CONTROL_SCHEMA_VERSION,
  CONTROL_STATEMENT_TIMEOUT_MS,
  checkControlDatabase,
  createControlPool,
} from '../../src/db/pool'

const readyResult = (overrides: Record<string, unknown> = {}) => ({
  rows: [
    {
      runtime_role: CONTROL_RUNTIME_ROLE,
      version: CONTROL_SCHEMA_VERSION,
      can_insert: true,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      ...overrides,
    },
  ],
})

describe('control pool', () => {
  test('uses the bounded control settings and the runtime role', async () => {
    const pool = createControlPool(
      'postgresql://almonac:local-password@127.0.0.1:5433/almonac_control',
    )

    expect(pool.options.max).toBe(CONTROL_POOL_MAX)
    expect(pool.options.connectionTimeoutMillis).toBe(CONTROL_CONNECTION_TIMEOUT_MS)
    expect(pool.options.idleTimeoutMillis).toBe(CONTROL_IDLE_TIMEOUT_MS)
    expect(pool.options.statement_timeout).toBe(CONTROL_STATEMENT_TIMEOUT_MS)
    expect(pool.options.idle_in_transaction_session_timeout).toBe(
      CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    )
    expect(pool.options.application_name).toBe('almonac-api-control')
    expect(pool.options.options).toBe(
      `-c search_path=public -c role=${CONTROL_RUNTIME_ROLE}`,
    )

    await pool.end()
  })
})

describe('checkControlDatabase', () => {
  test('accepts a migrated schema and the least-privilege role', async () => {
    const calls: string[] = []

    await checkControlDatabase({
      query: async (text) => {
        calls.push(text)
        return readyResult()
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('control.schema_metadata')
    expect(calls[0]).toContain("has_table_privilege('audit.event', 'INSERT')")
    expect(calls[0]).toContain("has_table_privilege('audit.event', 'UPDATE')")
    expect(calls[0]).toContain("has_table_privilege('audit.event', 'DELETE')")
    expect(calls[0]).toContain("has_table_privilege('audit.event', 'TRUNCATE')")
  })

  test('rejects a missing schema row', async () => {
    await expect(
      checkControlDatabase({ query: async () => ({ rows: [] }) }),
    ).rejects.toThrow('control database is not ready')
  })

  test('rejects a connection outside the runtime role', async () => {
    await expect(
      checkControlDatabase({
        query: async () => readyResult({ runtime_role: 'almonac' }),
      }),
    ).rejects.toThrow('control database is not ready')
  })

  test('rejects an unexpected schema version', async () => {
    await expect(
      checkControlDatabase({
        query: async () => readyResult({ version: CONTROL_SCHEMA_VERSION + 1 }),
      }),
    ).rejects.toThrow('control database is not ready')
  })

  test('rejects missing insert or retained audit privileges', async () => {
    for (const overrides of [
      { can_insert: false },
      { can_update: true },
      { can_delete: true },
      { can_truncate: true },
    ]) {
      await expect(
        checkControlDatabase({ query: async () => readyResult(overrides) }),
      ).rejects.toThrow('control database is not ready')
    }
  })

  test('rejects a malformed query result', async () => {
    await expect(
      checkControlDatabase({ query: async () => ({ rows: [{}] }) }),
    ).rejects.toThrow('control database is not ready')
  })

  test('propagates a connection failure', async () => {
    await expect(
      checkControlDatabase({
        query: async () => {
          throw new Error('connection refused')
        },
      }),
    ).rejects.toThrow('connection refused')
  })
})
