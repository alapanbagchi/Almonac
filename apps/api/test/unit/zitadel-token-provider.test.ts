import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import {
  createServiceUserTokenProvider,
  ZitadelUnavailableError,
} from '../../src/admin/zitadel-management-client'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const key = {
  issuer: 'http://localhost:8080',
  userId: 'service-user',
  keyId: 'key-1',
  privateKeyPem: privateKey,
}

describe('service-user token provider', () => {
  test('maps a network failure to an unavailable error', async () => {
    const provider = createServiceUserTokenProvider(
      key,
      Object.assign(
        async () => {
          throw new TypeError('fetch failed')
        },
        { preconnect: () => undefined },
      ),
    )

    await expect(provider.token()).rejects.toBeInstanceOf(ZitadelUnavailableError)
  })

  test('reuses a cached token instead of asking the provider again', async () => {
    let calls = 0
    const provider = createServiceUserTokenProvider(
      key,
      Object.assign(
        async () => {
          calls += 1
          return Response.json({ access_token: 'token', expires_in: 300 })
        },
        { preconnect: () => undefined },
      ),
    )

    expect(await provider.token()).toBe('token')
    expect(await provider.token()).toBe('token')
    expect(calls).toBe(1)
  })
})
