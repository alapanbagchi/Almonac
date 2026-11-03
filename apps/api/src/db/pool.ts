import { Pool } from 'pg'

/** ADR-002: a bounded control pool, five connections per API replica. */
export const CONTROL_POOL_MAX = 5
export const CONTROL_CONNECTION_TIMEOUT_MS = 5_000
export const CONTROL_IDLE_TIMEOUT_MS = 30_000
export const CONTROL_STATEMENT_TIMEOUT_MS = 10_000
export const CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000

export interface DatabaseQuery {
  query(text: string): Promise<unknown>
}

/**
 * Create the control database pool. Queries are schema-qualified, so the
 * search path is pinned to public and never depends on the caller.
 */
export function createControlPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: CONTROL_POOL_MAX,
    connectionTimeoutMillis: CONTROL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: CONTROL_IDLE_TIMEOUT_MS,
    statement_timeout: CONTROL_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    application_name: 'almonac-api-control',
    options: '-c search_path=public',
  })

  pool.on('error', (error: Error) => {
    // An idle client failed. Log the class only; connection details are secret.
    console.error('[api] idle database client error:', error.name)
  })

  return pool
}

/** Readiness probe: the pool can open a connection and run a trivial query. */
export async function checkControlDatabase(db: DatabaseQuery): Promise<void> {
  await db.query('SELECT 1')
}
