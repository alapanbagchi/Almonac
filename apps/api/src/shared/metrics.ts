/**
 * Operational counters. A metric is one JSON object on stdout with a fixed
 * name and a small allowlist of attributes; identifiers, tokens, email
 * addresses and free text never reach it. The deployment ships these lines to
 * its log pipeline, which counts them.
 */
export type MetricName =
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.id_token_rejected'
  | 'auth.session_revoked'
  | 'auth.rate_limited'
  | 'admin.provisioning_lag'

export type MetricAttributes = Readonly<Record<string, string | number>>

export interface Metrics {
  count(name: MetricName, attributes?: MetricAttributes): void
}

const ATTRIBUTE_KEYS = new Set([
  'reason',
  'purpose',
  'route',
  'outcome',
  'duration_ms',
])

/** Bounded values only: an identifier or token would not match. */
const SAFE_VALUE = /^[a-z0-9_.:-]{1,64}$/i

export function createMetrics(
  write: (line: string) => void = (line) => console.info(line),
): Metrics {
  return {
    count(name, attributes = {}) {
      const fields: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(attributes)) {
        if (!ATTRIBUTE_KEYS.has(key)) continue
        if (typeof value === 'number') {
          if (Number.isFinite(value) && value >= 0) fields[key] = value
          continue
        }
        if (SAFE_VALUE.test(value)) fields[key] = value
      }
      write(JSON.stringify({ metric: name, ...fields }))
    },
  }
}

/** A metrics implementation for tests and for callers that opt out. */
export const NO_METRICS: Metrics = { count() {} }
