import { describe, expect, test } from 'bun:test'
import {
  ZitadelManagementClient,
  ZitadelUnavailableError,
} from '../../src/admin/zitadel-management-client'

const tokens = { token: async () => 'access-token' }

function clientReturning(response: Response): ZitadelManagementClient {
  const fetchImpl: typeof fetch = Object.assign(
    async () => response,
    { preconnect: () => undefined },
  )
  return new ZitadelManagementClient('https://zitadel.example.com', tokens, fetchImpl)
}

describe('Zitadel management client', () => {
  test('maps a malformed provider body to an unavailable error', async () => {
    const client = clientReturning(new Response('{'))

    await expect(client.createOrganisation('Acme')).rejects.toBeInstanceOf(
      ZitadelUnavailableError,
    )
  })

  test('maps an oversized provider body to an unavailable error', async () => {
    const client = clientReturning(new Response('x'.repeat(64 * 1024 + 1)))

    await expect(client.createOrganisation('Acme')).rejects.toBeInstanceOf(
      ZitadelUnavailableError,
    )
  })
})
