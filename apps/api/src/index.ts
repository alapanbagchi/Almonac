import { createApp } from './app'
import { AuthConfigError, loadAuthConfig } from './adapters/oidc/config'
import { createOidcProvider } from './adapters/oidc/provider'
import { loadMailConfig, MailConfigError } from './adapters/smtp/config'
import { createSmtpMailer, createVerificationMailer } from './adapters/smtp/mailer'
import { createServiceUserTokenProvider, ZitadelManagementClient } from './adapters/zitadel/client'
import {
  ZitadelManagementConfigError,
  loadZitadelManagementConfig,
} from './adapters/zitadel/config'
import { ZitadelLoginClient } from './adapters/zitadel/login-client'
import { ConfigError, loadConfig } from './config'
import type {
  AdminDependencies,
  OrganisationIdentity,
} from './controllers/admin/dependencies'
import { createAuthRateLimit, type AuthDependencies } from './controllers/auth/dependencies'
import { sessionServiceOf } from './controllers/auth/session'
import {
  checkControlDatabase,
  createControlPool,
  withTransaction,
  type TransactionRunner,
} from './db/pool'
import { MAX_BODY_BYTES } from './plugins/security'
import { createAppUserRepository } from './repositories/app-user-repository'
import { createAuthorizationRepository } from './repositories/authorization-repository'
import { createRateLimitRepository } from './repositories/rate-limit-repository'
import { createAuditWriter } from './shared/audit-writer'
import type { AccessTarget } from './shared/access-target'
import { createAuthorize, createIsPlatformAdmin, createRolePermissions } from './shared/authorize'
import { forbidden } from './shared/errors'
import { createMetrics } from './shared/metrics'
import { bcryptPasswordHasher } from './shared/password-hash'

const config = loadConfigOrExit(loadConfig, 'config')
const authConfig = loadConfigOrExit(loadAuthConfig, 'auth config')
const mailConfig = loadConfigOrExit(() => loadMailConfig(process.env), 'mail config')
const managementConfig = loadConfigOrExit(
  () => loadZitadelManagementConfig(process.env),
  'Zitadel management config',
)

const pool = createControlPool(config.databaseUrl)
const transaction: TransactionRunner = (run) => withTransaction(pool, run)
const metrics = createMetrics()
const audit = createAuditWriter(pool)
const users = createAppUserRepository(pool)
const authorization = createAuthorizationRepository(pool)

const serviceTokens = createServiceUserTokenProvider({
  issuer: managementConfig.issuer,
  userId: managementConfig.serviceUserId,
  keyId: managementConfig.keyId,
  privateKeyPem: managementConfig.privateKeyPem,
})
const zitadel = new ZitadelManagementClient(managementConfig.issuer, serviceTokens)
const smtpOptions = {
  smtpUrl: mailConfig.smtpUrl,
  smtpUser: mailConfig.smtpUser,
  smtpPassword: mailConfig.smtpPassword,
  from: mailConfig.from,
  fromName: mailConfig.fromName,
  requireTls: mailConfig.requireTls,
  webPublicOrigin: mailConfig.webPublicOrigin,
}

const auth: AuthDependencies = {
  db: pool,
  transaction,
  oidc: createOidcProvider({
    issuer: authConfig.issuer,
    clientId: authConfig.clientId,
    clientSecret: authConfig.clientSecret,
    redirectUri: authConfig.redirectUri,
    postLogoutUri: authConfig.postLogoutUri,
  }),
  sealingKey: authConfig.sealingKey,
  audit,
  mailer: createVerificationMailer(smtpOptions),
  identities: zitadel,
  loginClient: new ZitadelLoginClient({
    issuer: managementConfig.issuer,
    loginClientUserId: managementConfig.serviceUserId,
    redirectUri: authConfig.redirectUri,
    tokens: serviceTokens,
  }),
  passwords: bcryptPasswordHasher,
  metrics,
  rateLimit: createAuthRateLimit({
    store: createRateLimitRepository(pool),
    metrics,
  }),
}

const sessions = sessionServiceOf(auth)

// The provisioning transaction writes the organisation against a provider
// account; onboarding and the admin plane share that one capability.
const organisationIdentity: OrganisationIdentity = {
  create: (name) => zitadel.createOrganisation(name),
}

const admin: AdminDependencies = {
  db: pool,
  transaction,
  authorize: createAuthorize(authorization),
  permissions: createRolePermissions(authorization),
  isPlatformAdmin: createIsPlatformAdmin(authorization),
  audit,
  sessions,
  users,
  organisationIdentity,
  metrics,
}

/**
 * Break-glass is deliberately narrower than the admin rule: a platform
 * administrator may read the admin plane, but only an approver may grant
 * emergency access, so there is no platform.manage bypass here.
 */
const breakGlassAuthorize = async (
  actorId: string,
  permission: string,
  target: AccessTarget,
): Promise<void> => {
  if (!(await authorization.hasPermission(actorId, permission, target))) throw forbidden()
}

const app = createApp({
  checkDatabase: () => checkControlDatabase(pool),
  auth,
  onboarding: { db: pool, transaction, audit, organisationIdentity, sessions, users },
  admin,
  invitations: { ...admin, mailer: createSmtpMailer(smtpOptions), identity: zitadel },
  breakGlass: {
    db: pool,
    transaction,
    authorize: breakGlassAuthorize,
    hasAnyPlatformPermission: (actorId, permissions) =>
      authorization.hasAnyPlatformPermission(actorId, permissions),
    users,
    audit,
    sessions,
  },
  serve: { maxRequestBodySize: MAX_BODY_BYTES },
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

/**
 * Startup configuration is validated once. Every loader signals a bad
 * environment with an error that carries its issues, so the process reports
 * them by name and exits instead of starting half-configured.
 */
function loadConfigOrExit<T>(load: () => T, label: string): T {
  try {
    return load()
  } catch (error) {
    if (error instanceof ConfigError || error instanceof AuthConfigError ||
        error instanceof MailConfigError || error instanceof ZitadelManagementConfigError) {
      for (const issue of error.issues) console.error(`[api] ${label}: ${issue}`)
    } else {
      console.error(`[api] ${label}: unexpected validation failure`)
    }
    process.exit(1)
  }
}