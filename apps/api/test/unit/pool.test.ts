import { describe, expect, test } from 'bun:test'
import {
  CONTROL_CONNECTION_TIMEOUT_MS,
  CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  CONTROL_IDLE_TIMEOUT_MS,
  CONTROL_POOL_MAX,
  CONTROL_STATEMENT_TIMEOUT_MS,
  checkControlDatabase,
  createControlPool,
} from '../../src/db/pool'

describe('control pool', () => {
  test('uses the bounded control settings', async () => {
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
    expect(pool.options.options).toBe('-c search_path=public')

    await pool.end()
  })
})

describe('checkControlDatabase', () => {
  test('runs a trivial query', async () => {
    const calls: string[] = []

    await checkControlDatabase({
      query: async (text) => {
        calls.push(text)
      },
    })

    expect(calls).toEqual(['SELECT 1'])
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
