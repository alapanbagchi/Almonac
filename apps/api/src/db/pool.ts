import { Pool } from 'pg'
import { safeName } from '../shared/log'

/** ADR-002: a bounded control pool, five connections per API replica. */
export const CONTROL_POOL_MAX = 5
export const CONTROL_RUNTIME_ROLE = 'almonac_app'
export const CONTROL_SCHEMA_VERSION = 8
export const CONTROL_CONNECTION_TIMEOUT_MS = 5_000
export const CONTROL_IDLE_TIMEOUT_MS = 30_000
export const CONTROL_STATEMENT_TIMEOUT_MS = 10_000
export const CONTROL_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000

export interface DatabaseResult {
  readonly rows: readonly unknown[]
}

/**
 * The narrow database surface that repositories use. It deliberately hides
 * pool and client details, so a repository cannot leak a connection or choose
 * its own role. Rows stay unknown until the repository validates them.
 */
export interface DatabaseQuery {
  query(text: string, values?: unknown[]): Promise<DatabaseResult>
}

/**
 * Create the control database pool. Every connection assumes the unprivileged
 * runtime role; the login role must be allowed to SET ROLE to that role.
 * Queries are schema-qualified, so the search path never depends on the caller.
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
    options: `-c search_path=public -c role=${CONTROL_RUNTIME_ROLE}`,
  })

  pool.on('error', (error: Error) => {
    // An idle client failed. Log the class only; connection details are secret.
    console.error('[api] idle database client error:', safeName(error))
  })

  return pool
}

/**
 * Run repository work in one transaction. A failed rollback destroys the
 * connection instead of returning an unknown state to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  run: (db: DatabaseQuery) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let broken = false

  try {
    await client.query('begin')
    const result = await run({
      query: (text, values) => client.query(text, values),
    })
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      broken = true
    }
    throw error
  } finally {
    client.release(broken)
  }
}

const READINESS_QUERY = `
  select
    current_user as runtime_role,
    (select version from control.schema_metadata where id = 1) as version,
    has_table_privilege('audit.event', 'INSERT') as can_insert,
    has_table_privilege('audit.event', 'UPDATE') as can_update,
    has_table_privilege('audit.event', 'DELETE') as can_delete,
    has_table_privilege('audit.event', 'TRUNCATE') as can_truncate
`

interface ReadinessRow {
  runtimeRole: string
  version: number
  canInsert: boolean
  canUpdate: boolean
  canDelete: boolean
  canTruncate: boolean
}

/**
 * Readiness requires a migrated schema and the least-privilege runtime role.
 * A connection that can rewrite audit events is never ready.
 */
export async function checkControlDatabase(db: DatabaseQuery): Promise<void> {
  const row = readReadiness(await db.query(READINESS_QUERY))

  if (
    row === undefined ||
    row.runtimeRole !== CONTROL_RUNTIME_ROLE ||
    row.version !== CONTROL_SCHEMA_VERSION ||
    !row.canInsert ||
    row.canUpdate ||
    row.canDelete ||
    row.canTruncate
  ) {
    throw new Error('control database is not ready')
  }
}

function readReadiness(result: unknown): ReadinessRow | undefined {
  if (typeof result !== 'object' || result === null) return undefined

  const rows = (result as { rows?: unknown }).rows
  if (!Array.isArray(rows) || rows.length !== 1) return undefined

  const row = rows[0]
  if (typeof row !== 'object' || row === null) return undefined

  const values = row as Record<string, unknown>
  if (
    typeof values.runtime_role !== 'string' ||
    typeof values.version !== 'number' ||
    typeof values.can_insert !== 'boolean' ||
    typeof values.can_update !== 'boolean' ||
    typeof values.can_delete !== 'boolean' ||
    typeof values.can_truncate !== 'boolean'
  ) {
    return undefined
  }

  return {
    runtimeRole: values.runtime_role,
    version: values.version,
    canInsert: values.can_insert,
    canUpdate: values.can_update,
    canDelete: values.can_delete,
    canTruncate: values.can_truncate,
  }
}
