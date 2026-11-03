import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

export type MigrationDirection = 'up' | 'down'

/**
 * Apply migrations programmatically. Used by tests and by operational tooling;
 * normal deployment runs the node-pg-migrate CLI with the same directory.
 */
export async function migrateDatabase(
  databaseUrl: string,
  direction: MigrationDirection,
  count?: number,
): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count,
    migrationsTable: 'pgmigrations',
    schema: 'public',
    migrationsSchema: 'public',
    createSchema: false,
    createMigrationsSchema: false,
    checkOrder: true,
    singleTransaction: true,
    log: (message) => {
      if (process.env.NODE_ENV !== 'test') console.info(message)
    },
  })
}
