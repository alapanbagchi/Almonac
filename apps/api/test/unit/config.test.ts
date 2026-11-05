import { describe, expect, test } from 'bun:test'
import { ConfigError, loadConfig } from '../../src/config'

const validDatabaseUrl =
  'postgresql://almonac:local-password@127.0.0.1:5433/almonac_registry'

describe('loadConfig', () => {
  test('applies local defaults', () => {
    const config = loadConfig({ DATABASE_URL: validDatabaseUrl })

    expect(config).toEqual({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: validDatabaseUrl,
    })
  })

  test('rejects an empty environment', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  test('accepts production with a verifying sslmode', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: `${validDatabaseUrl}?sslmode=verify-full`,
    })

    expect(config.nodeEnv).toBe('production')
    expect(config.port).toBe(8080)
  })

  test('rejects production without verify-full', () => {
    for (const query of ['', '?sslmode=require', '?sslmode=verify-ca']) {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          DATABASE_URL: `${validDatabaseUrl}${query}`,
        }),
      ).toThrow(ConfigError)
    }
  })

  test('rejects malformed values without echoing them', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'staging',
        PORT: 'not-a-port',
        DATABASE_URL: 'postgresql://user:supersecret@/missing-database#fragment',
      }),
    ).toThrow(ConfigError)

    try {
      loadConfig({
        NODE_ENV: 'staging',
        PORT: 'not-a-port',
        DATABASE_URL: 'postgresql://user:supersecret@/missing-database#fragment',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const issues = (error as ConfigError).issues.join(' ')
      expect(issues).toContain('NODE_ENV')
      expect(issues).toContain('PORT')
      expect(issues).toContain('DATABASE_URL')
      expect(issues).not.toContain('supersecret')
      expect(issues).not.toContain('missing-database')
    }
  })
})
