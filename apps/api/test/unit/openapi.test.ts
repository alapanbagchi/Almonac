import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../helpers/app'

describe('OpenAPI', () => {
  test('exposes the health routes', async () => {
    const app = createTestApp()
    const response = await app.handle(new Request('http://localhost/openapi/json'))
    const body = (await response.json()) as {
      paths: Record<string, unknown>
    }

    expect(response.status).toBe(200)
    expect(body.paths).toHaveProperty('/health')
    expect(body.paths).toHaveProperty('/health/ready')
  })
})
