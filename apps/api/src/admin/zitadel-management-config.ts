export interface ZitadelManagementConfig {
  readonly issuer: string
  readonly serviceUserId: string
  readonly keyId: string
  readonly privateKeyPem: string
}

export class ZitadelManagementConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super('Invalid Zitadel management configuration')
    this.name = 'ZitadelManagementConfigError'
  }
}

export function loadZitadelManagementConfig(
  env: Readonly<Record<string, string | undefined>>,
): ZitadelManagementConfig {
  const issuer = env.ZITADEL_ISSUER?.trim() ?? ''
  const serviceUserId = env.ZITADEL_SERVICE_USER_ID?.trim() ?? ''
  const keyId = env.ZITADEL_SERVICE_USER_KEY_ID?.trim() ?? ''
  const privateKeyPem = (env.ZITADEL_SERVICE_USER_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  const production = env.NODE_ENV === 'production'

  const issues: string[] = []
  if (!isHttpUrl(issuer, production)) {
    issues.push(`ZITADEL_ISSUER must be ${production ? 'an https' : 'an http or https'} URL.`)
  }
  if (serviceUserId.length === 0) issues.push('ZITADEL_SERVICE_USER_ID is required.')
  if (keyId.length === 0) issues.push('ZITADEL_SERVICE_USER_KEY_ID is required.')
  if (!privateKeyPem.includes('BEGIN') || !privateKeyPem.includes('PRIVATE KEY')) {
    issues.push('ZITADEL_SERVICE_USER_PRIVATE_KEY must be a PEM private key.')
  }
  if (issues.length > 0) throw new ZitadelManagementConfigError(issues)

  return { issuer, serviceUserId, keyId, privateKeyPem }
}

function isHttpUrl(value: string, httpsOnly: boolean): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')
  } catch {
    return false
  }
}
