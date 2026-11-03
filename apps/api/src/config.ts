/** Runtime configuration, read once at startup. */
export type NodeEnv = 'development' | 'test' | 'production'

export interface Config {
  readonly nodeEnv: NodeEnv
  readonly port: number
  readonly databaseUrl: string
}

export type Env = Record<string, string | undefined>

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production']

/** Read every known label once and fail closed on any malformed value. */
export function loadConfig(env: Env = process.env): Config {
  const issues: string[] = []
  const port = env.PORT || '3001'
  const nodeEnv = NODE_ENVS.find((value) => value === (env.NODE_ENV || 'development'))
  const databaseUrl = env.DATABASE_URL?.trim() ?? ''

  if (!nodeEnv) issues.push('NODE_ENV must be development, test or production.')
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    issues.push('PORT must be an integer between 1 and 65535.')
  }

  if (!databaseUrl) {
    issues.push('DATABASE_URL is required.')
  } else {
    try {
      const url = new URL(databaseUrl)
      issues.push(
        ...[
          !['postgres:', 'postgresql:'].includes(url.protocol) &&
            'DATABASE_URL must use the postgres or postgresql scheme.',
          !url.hostname && 'DATABASE_URL must include a host.',
          (!url.pathname || url.pathname === '/') &&
            'DATABASE_URL must include a database name.',
          url.hash && 'DATABASE_URL must not include a fragment.',
          nodeEnv === 'production' &&
            url.searchParams.get('sslmode') !== 'verify-full' &&
            'DATABASE_URL must set sslmode to verify-full in production.',
        ].filter((issue): issue is string => Boolean(issue)),
      )
    } catch {
      issues.push('DATABASE_URL must be a valid PostgreSQL URL.')
    }
  }

  if (issues.length) throw new ConfigError(issues)

  return { nodeEnv: nodeEnv ?? 'development', port: Number(port), databaseUrl }
}
