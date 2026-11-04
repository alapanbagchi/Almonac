export interface MailConfig {
  readonly smtpUrl: string
  readonly smtpUser: string | null
  readonly smtpPassword: string | null
  readonly from: string
  readonly fromName: string
  readonly webPublicOrigin: string
  readonly requireTls: boolean
}

export class MailConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super('Invalid mail configuration')
    this.name = 'MailConfigError'
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

export function loadMailConfig(
  env: Readonly<Record<string, string | undefined>>,
): MailConfig {
  const smtpUrl = env.SMTP_URL?.trim() ?? ''
  const smtpUser = env.SMTP_USER?.trim() || null
  const smtpPassword = env.SMTP_PASSWORD || null
  const from = env.MAIL_FROM?.trim() ?? ''
  const fromName = env.MAIL_FROM_NAME?.trim() || 'Almonac'
  const webPublicOrigin = env.WEB_PUBLIC_ORIGIN?.trim() ?? ''
  const production = env.NODE_ENV === 'production'
  const smtp = parseSmtpUrl(smtpUrl)

  const issues: string[] = []
  if (smtp === null) {
    issues.push('SMTP_URL must be an smtp or smtps URL without credentials, query or fragment.')
  }
  if ((smtpUser === null) !== (smtpPassword === null)) {
    issues.push('SMTP_USER and SMTP_PASSWORD must be set together.')
  }
  if (production && smtpUser === null) {
    issues.push('SMTP_USER and SMTP_PASSWORD are required in production.')
  }
  if (production && smtp !== null && LOCAL_HOSTS.has(smtp.hostname)) {
    issues.push('SMTP_URL must not use a loopback host in production.')
  }
  if (!isEmail(from)) issues.push('MAIL_FROM must be an email address.')
  if (/[\r\n]/.test(fromName) || fromName.length > 100) {
    issues.push('MAIL_FROM_NAME must be one line of at most 100 characters.')
  }
  if (!isUrl(webPublicOrigin, production ? ['https:'] : ['http:', 'https:'])) {
    issues.push(`WEB_PUBLIC_ORIGIN must be ${production ? 'an https' : 'an http or https'} URL.`)
  }
  if (issues.length > 0) throw new MailConfigError(issues)

  return {
    smtpUrl,
    smtpUser,
    smtpPassword,
    from,
    fromName,
    webPublicOrigin: new URL(webPublicOrigin).origin,
    requireTls: production && smtp?.protocol === 'smtp:',
  }
}

function parseSmtpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    const validProtocol = url.protocol === 'smtp:' || url.protocol === 'smtps:'
    const clean =
      url.username === '' && url.password === '' && url.search === '' && url.hash === ''
    return validProtocol && clean && url.hostname !== '' ? url : null
  } catch {
    return null
  }
}

function isEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isUrl(value: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) && url.username === '' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}
