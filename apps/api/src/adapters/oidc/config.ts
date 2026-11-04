import { sealingKey, type SealingKey } from '../../shared/sealed'

export interface AuthConfig {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly postLogoutUri: string
  readonly sealingKey: SealingKey
}

export type Env = Record<string, string | undefined>

export class AuthConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid authentication configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'AuthConfigError'
  }
}

/** Read the identity-provider and sealing configuration once, at startup. */
export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const issues: string[] = []
  const requireHttps = env.NODE_ENV === 'production'
  const issuer = readUrl(env.ZITADEL_ISSUER, 'ZITADEL_ISSUER', issues, requireHttps)
  const redirectUri = readUrl(
    env.ZITADEL_REDIRECT_URI,
    'ZITADEL_REDIRECT_URI',
    issues,
    requireHttps,
  )
  const postLogoutUri = readUrl(
    env.ZITADEL_POST_LOGOUT_URI,
    'ZITADEL_POST_LOGOUT_URI',
    issues,
    requireHttps,
  )
  const clientId = env.ZITADEL_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.ZITADEL_CLIENT_SECRET?.trim() ?? ''
  const keyVersion = readKeyVersion(env.SEALING_KEY_VERSION, issues)
  const key = readSealingKey(env.SEALING_KEY, keyVersion, issues)

  if (!clientId) issues.push('ZITADEL_CLIENT_ID is required.')
  if (!clientSecret) issues.push('ZITADEL_CLIENT_SECRET is required.')

  if (issues.length) throw new AuthConfigError(issues)

  return {
    issuer: issuer!,
    clientId,
    clientSecret,
    redirectUri: redirectUri!,
    postLogoutUri: postLogoutUri!,
    sealingKey: key!,
  }
}

function readUrl(
  raw: string | undefined,
  label: string,
  issues: string[],
  requireHttps: boolean,
): string | undefined {
  const value = raw?.trim() ?? ''
  if (!value) {
    issues.push(`${label} is required.`)
    return undefined
  }

  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) {
      issues.push(`${label} must use http or https.`)
      return undefined
    }
    if (requireHttps && url.protocol !== 'https:') {
      issues.push(`${label} must use https in production.`)
      return undefined
    }
    if (url.username || url.password) {
      issues.push(`${label} must not contain credentials.`)
      return undefined
    }
    if (url.search || url.hash) {
      issues.push(`${label} must not contain a query or fragment.`)
      return undefined
    }

    return value.replace(/\/+$/, '')
  } catch {
    issues.push(`${label} must be a valid URL.`)
    return undefined
  }
}

function readKeyVersion(raw: string | undefined, issues: string[]): number | undefined {
  const value = raw?.trim() || '1'
  if (!/^\d+$/.test(value)) {
    issues.push('SEALING_KEY_VERSION must be an integer between 1 and 32767.')
    return undefined
  }

  const version = Number(value)
  if (version < 1 || version > 32_767) {
    issues.push('SEALING_KEY_VERSION must be an integer between 1 and 32767.')
    return undefined
  }

  return version
}

function readSealingKey(
  raw: string | undefined,
  version: number | undefined,
  issues: string[],
): SealingKey | undefined {
  const value = raw?.trim() ?? ''
  if (!value) {
    issues.push('SEALING_KEY is required.')
    return undefined
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    issues.push('SEALING_KEY must be unpadded base64url for exactly 32 bytes.')
    return undefined
  }

  const bytes = Buffer.from(value, 'base64url')
  if (bytes.byteLength !== 32) {
    issues.push('SEALING_KEY must decode to exactly 32 bytes.')
    return undefined
  }

  try {
    return sealingKey(version ?? 1, bytes)
  } catch {
    issues.push('SEALING_KEY or SEALING_KEY_VERSION is invalid.')
    return undefined
  }
}
