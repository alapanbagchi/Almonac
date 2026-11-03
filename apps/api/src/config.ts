/**
 * Runtime configuration. Read once at startup; fail closed on anything
 * malformed. Auth-specific settings (Zitadel, sealing key) are added with the
 * auth module that consumes them, not before.
 */
export type NodeEnv = 'development' | 'test' | 'production'

export interface Config {
  readonly nodeEnv: NodeEnv
  readonly port: number
  readonly databaseUrl: string
}

export type Env = Record<string, string | undefined>

export class ConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/**
 * Parse and validate environment variables. The returned object is the only
 * configuration the process should use.
 */
export function loadConfig(env: Env = process.env): Config {
  const issues: string[] = []
  const nodeEnv = readNodeEnv(env.NODE_ENV, issues)
  const port = readPort(env.PORT, issues)
  const databaseUrl = readDatabaseUrl(env.DATABASE_URL, nodeEnv, issues)

  if (issues.length > 0) throw new ConfigError(issues)

  return { nodeEnv, port, databaseUrl }
}

function readNodeEnv(raw: string | undefined, issues: string[]): NodeEnv {
  if (raw === undefined || raw === '') return 'development'

  if (raw === 'development' || raw === 'test' || raw === 'production') return raw

  issues.push('NODE_ENV must be development, test or production.')
  return 'development'
}

function readPort(raw: string | undefined, issues: string[]): number {
  if (raw === undefined || raw === '') return 3001

  if (!/^\d+$/.test(raw)) {
    issues.push('PORT must be an integer between 1 and 65535.')
    return 3001
  }

  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    issues.push('PORT must be an integer between 1 and 65535.')
    return 3001
  }

  return port
}

function readDatabaseUrl(
  raw: string | undefined,
  nodeEnv: NodeEnv,
  issues: string[],
): string {
  if (raw === undefined || raw.trim() === '') {
    issues.push('DATABASE_URL is required.')
    return ''
  }

  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    issues.push('DATABASE_URL must be a valid PostgreSQL URL.')
    return ''
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    issues.push('DATABASE_URL must use the postgres or postgresql scheme.')
  }

  if (url.hostname === '') {
    issues.push('DATABASE_URL must include a host.')
  }

  if (url.pathname === '' || url.pathname === '/') {
    issues.push('DATABASE_URL must include a database name.')
  }

  if (url.hash !== '') {
    issues.push('DATABASE_URL must not include a fragment.')
  }

  if (nodeEnv === 'production') {
    if (url.searchParams.get('sslmode') !== 'verify-full') {
      issues.push('DATABASE_URL must set sslmode to verify-full in production.')
    }
  }

  return value
}
