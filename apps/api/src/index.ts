import { createApp } from './app'
import { ConfigError, loadConfig } from './config'
import { checkControlDatabase, createControlPool } from './db/pool'

const config = loadConfigOrExit()

const pool = createControlPool(config.databaseUrl)
const app = createApp({ checkDatabase: () => checkControlDatabase(pool) })

const server = app.listen(config.port)
console.info(`[api] listening on ${config.port}`)

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.info(`[api] ${signal} received; shutting down`)
  await server.stop()
  await pool.end()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

function loadConfigOrExit() {
  try {
    return loadConfig()
  } catch (error) {
    const issues =
      error instanceof ConfigError ? error.issues : ['unexpected validation failure']
    for (const issue of issues) console.error(`[api] config: ${issue}`)
    process.exit(1)
  }
}
