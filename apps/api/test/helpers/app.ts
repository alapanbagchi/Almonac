import { createApp } from '../../src/app'

export function createTestApp(
  checkDatabase: () => Promise<void> = async () => {},
  readinessTimeoutMs = 50,
) {
  return createApp({ checkDatabase, readinessTimeoutMs })
}
