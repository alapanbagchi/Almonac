export interface MailConfig {
  readonly smtpUrl: string
  readonly smtpUser: string | null
  readonly smtpPassword: string | null
  readonly from: string
  readonly webPublicOrigin: string
}

export class MailConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super('Invalid mail configuration')
    this.name = 'MailConfigError'
  }
}

export function loadMailConfig(
  env: Readonly<Record<string, string | undefined>>,
): MailConfig {
  const smtpUrl = env.SMTP_URL?.trim() ?? ''
  const smtpUser = env.SMTP_USER?.trim() || null
  const smtpPassword = env.SMTP_PASSWORD || null
  const from = env.MAIL_FROM?.trim() ?? ''
  const webPublicOrigin = env.WEB_PUBLIC_ORIGIN?.trim() ?? ''
  const production = env.NODE_ENV === 'production'

  const issues: string[] = []
  if (!isUrl(smtpUrl, ['smtp:', 'smtps:'])) issues.push('SMTP_URL must be an smtp URL.')
  if ((smtpUser === null) !== (smtpPassword === null)) {
    issues.push('SMTP_USER and SMTP_PASSWORD must be set together.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) issues.push('MAIL_FROM must be an email address.')
  if (!isUrl(webPublicOrigin, production ? ['https:'] : ['http:', 'https:'])) {
    issues.push(`WEB_PUBLIC_ORIGIN must be ${production ? 'an https' : 'an http or https'} URL.`)
  }
  if (issues.length > 0) throw new MailConfigError(issues)

  return {
    smtpUrl,
    smtpUser,
    smtpPassword,
    from,
    webPublicOrigin: new URL(webPublicOrigin).origin,
  }
}

function isUrl(value: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) && url.username === '' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}
