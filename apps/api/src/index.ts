import { createApp } from './app'
import { AuthorizationRepository } from './access/authorization-repository'
import { AccessRepository } from './identity/access-repository'
import { AppUserRepository } from './identity/app-user-repository'
import { SessionRepository } from './identity/session-repository'
import { SessionService } from './identity/session-service'
import { AuditReadRepository } from './admin/audit-read-repository'
import { AuditWriter } from './audit/audit-writer'
import { AuditAdminService } from './admin/audit-admin-service'
import { HospitalAdminService } from './admin/hospital-admin-service'
import { HospitalRepository } from './admin/hospital-repository'
import { InvitationRepository } from './admin/invitation-repository'
import { InvitationService } from './admin/invitation-service'
import { MembershipAdminRepository } from './admin/membership-admin-repository'
import { MembershipAdminService } from './admin/membership-admin-service'
import { loadMailConfig, MailConfigError } from './admin/mail-config'
import { OrganisationAdminService } from './admin/organisation-admin-service'
import { OrganisationProvisioningService } from './admin/organisation-provisioning-service'
import { OrganisationRepository } from './admin/organisation-repository'
import { createSmtpMailer } from './admin/smtp-mailer'
import {
  ZitadelManagementClient,
  createServiceUserTokenProvider,
} from './admin/zitadel-management-client'
import {
  loadZitadelManagementConfig,
  ZitadelManagementConfigError,
} from './admin/zitadel-management-config'
import { AuthConfigError, loadAuthConfig } from './auth/config'
import { BreakGlassService } from './break-glass/break-glass-service'
import { LoginAttemptRepository } from './auth/login-attempt-repository'
import { LoginService } from './auth/login-service'
import { createLogoutService } from './auth/logout-service'
import { createOidcProvider } from './auth/oidc-provider'
import { PostgresLoginStore } from './auth/postgres-login-store'
import { ConfigError, loadConfig } from './config'
import { checkControlDatabase, createControlPool } from './db/pool'

const config = loadConfigOrExit(loadConfig, ConfigError, 'config')
const authConfig = loadConfigOrExit(loadAuthConfig, AuthConfigError, 'auth config')
const mailConfig = loadConfigOrExit(() => loadMailConfig(process.env), MailConfigError, 'mail config')
const managementConfig = loadConfigOrExit(
  () => loadZitadelManagementConfig(process.env),
  ZitadelManagementConfigError,
  'Zitadel management config',
)

const pool = createControlPool(config.databaseUrl)
const audit = new AuditWriter(pool)
const users = new AppUserRepository(pool)
const authorization = new AuthorizationRepository(pool)
const sessions = new SessionService({ store: new SessionRepository(pool) })
const breakGlass = new BreakGlassService({ pool, authorization, users })
const oidc = createOidcProvider({
  issuer: authConfig.issuer,
  clientId: authConfig.clientId,
  clientSecret: authConfig.clientSecret,
  redirectUri: authConfig.redirectUri,
  postLogoutUri: authConfig.postLogoutUri,
})

const organisations = new OrganisationRepository(pool)
const hospitals = new HospitalRepository(pool)
const memberships = new MembershipAdminRepository(pool)
const invitations = new InvitationRepository(pool)
const zitadel = new ZitadelManagementClient(
  managementConfig.issuer,
  createServiceUserTokenProvider({
    issuer: managementConfig.issuer,
    userId: managementConfig.serviceUserId,
    keyId: managementConfig.keyId,
    privateKeyPem: managementConfig.privateKeyPem,
  }),
)

const app = createApp({
  checkDatabase: () => checkControlDatabase(pool),
  auth: {
    login: new LoginService({
      attempts: new LoginAttemptRepository(pool),
      oidc,
      completion: new PostgresLoginStore(pool),
      audit,
      sealingKey: authConfig.sealingKey,
    }),
    sessions,
    users,
    access: new AccessRepository(pool),
    logout: createLogoutService(pool, {
      sessions,
      oidc,
      sealingKey: authConfig.sealingKey,
    }),
  },
  admin: {
    organisations: new OrganisationAdminService(
      organisations,
      authorization,
      new OrganisationProvisioningService(pool, zitadel, audit),
    ),
    hospitals: new HospitalAdminService(hospitals, organisations, authorization, audit),
    memberships: new MembershipAdminService(memberships, authorization, audit),
    invitations: new InvitationService({
      pool,
      invitations,
      organisations,
      hospitals,
      memberships,
      users,
      authorization,
      zitadel,
      audit,
      mailer: createSmtpMailer({
        smtpUrl: mailConfig.smtpUrl,
        smtpUser: mailConfig.smtpUser,
        smtpPassword: mailConfig.smtpPassword,
        from: mailConfig.from,
        webPublicOrigin: mailConfig.webPublicOrigin,
      }),
    }),
    audit: new AuditAdminService(new AuditReadRepository(pool), authorization),
    sessions,
    users,
  },
  breakGlass: { grants: breakGlass, sessions, users },
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

function loadConfigOrExit<T>(
  load: () => T,
  errorType: new (issues: readonly string[]) => Error,
  label: string,
): T {
  try {
    return load()
  } catch (error) {
    const issues =
      error instanceof errorType ? (error as Error & { issues: readonly string[] }).issues : ['unexpected validation failure']
    for (const issue of issues) console.error(`[api] ${label}: ${issue}`)
    process.exit(1)
  }
}
