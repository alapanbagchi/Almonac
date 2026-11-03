import { createApp } from './app'
import { AuthConfigError, loadAuthConfig } from './auth/config'
import { LoginAttemptRepository } from './auth/login-attempt-repository'
import { LoginService } from './auth/login-service'
import { createLogoutService } from './auth/logout-service'
import { createOidcProvider } from './auth/oidc-provider'
import { PostgresLoginStore } from './auth/postgres-login-store'
import { AuditWriter } from './audit/audit-writer'
import { ConfigError, loadConfig } from './config'
import { checkControlDatabase, createControlPool } from './db/pool'
import { AccessRepository } from './identity/access-repository'
import { AppUserRepository } from './identity/app-user-repository'
import { SessionRepository } from './identity/session-repository'
import { SessionService } from './identity/session-service'

const config = loadConfigOrExit()
const authConfig = loadAuthConfigOrExit()

const pool = createControlPool(config.databaseUrl)
const sessions = new SessionService({ store: new SessionRepository(pool) })
const oidc = createOidcProvider({
  issuer: authConfig.issuer,
  clientId: authConfig.clientId,
  clientSecret: authConfig.clientSecret,
  redirectUri: authConfig.redirectUri,
  postLogoutUri: authConfig.postLogoutUri,
})

const app = createApp({
  checkDatabase: () => checkControlDatabase(pool),
  auth: {
    login: new LoginService({
      attempts: new LoginAttemptRepository(pool),
      oidc,
      completion: new PostgresLoginStore(pool),
      audit: new AuditWriter(pool),
      sealingKey: authConfig.sealingKey,
    }),
    sessions,
    users: new AppUserRepository(pool),
    access: new AccessRepository(pool),
    logout: createLogoutService(pool, {
      sessions,
      oidc,
      sealingKey: authConfig.sealingKey,
    }),
  },
})

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

function loadAuthConfigOrExit() {
  try {
    return loadAuthConfig()
  } catch (error) {
    const issues =
      error instanceof AuthConfigError
        ? error.issues
        : ['unexpected authentication validation failure']
    for (const issue of issues) console.error(`[api] auth config: ${issue}`)
    process.exit(1)
  }
}
