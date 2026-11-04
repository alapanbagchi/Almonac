import { describe, expect, test } from 'bun:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { loadAuthConfig, AuthConfigError } from '../../src/auth/config'
import { createIdTokenVerifier } from '../../src/auth/id-token-verifier'
import { createOidcDiscovery } from '../../src/auth/oidc-discovery'
import { exchangeAuthorizationCode } from '../../src/auth/oidc-token-client'
import { buildAuthorizationUrl, challengeFor, createLoginSecrets } from '../../src/auth/pkce'
import { normaliseReturnTo } from '../../src/auth/return-to'
import { OidcRejectedError, OidcUnavailableError } from '../../src/auth/errors'
import { hashToken } from '../../src/shared/tokens'
import type { FetchLike } from '../../src/auth/fetch'

const ISSUER = 'https://identity.example.test'
const CLIENT_ID = 'almonac-web'
const NOW = new Date('2026-01-01T10:00:00.000Z')

describe('pkce and return targets', () => {
  test('matches the RFC 7636 S256 vector', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  test('creates opaque secrets and an authorization URL without the verifier', () => {
    const secrets = createLoginSecrets()
    expect(secrets.state).toHaveLength(43)
    expect(secrets.nonce).toHaveLength(43)
    expect(secrets.verifier).toHaveLength(43)

    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: `${ISSUER}/authorize`,
        clientId: CLIENT_ID,
        redirectUri: 'https://app.example.test/api/auth/callback',
        state: secrets.state,
        nonce: secrets.nonce,
        challenge: secrets.challenge,
        prompt: 'login',
        maxAgeSeconds: 0,
      }),
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(secrets.challenge)
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('max_age')).toBe('0')
    expect(url.toString()).not.toContain(secrets.verifier)
  })

  test('accepts internal paths and rejects redirect tricks', () => {
    expect(normaliseReturnTo('/dashboard')).toBe('/dashboard')
    expect(normaliseReturnTo(undefined)).toBe('/')
    expect(() => normaliseReturnTo('')).toThrow()
    for (const value of ['https://evil.test', '//evil.test', '/' + String.fromCharCode(92) + 'evil', '/%5cevil', '/%2f%2fevil.test', '/%0d%0aLocation:%20https://evil.test', '/' + String.fromCharCode(0) + 'x']) {
      expect(() => normaliseReturnTo(value)).toThrow()
    }
    expect(() => normaliseReturnTo(42)).toThrow()
  })
})

describe('OIDC discovery', () => {
  test('caches metadata and rejects a different issuer', async () => {
    let calls = 0
    const metadata = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      end_session_endpoint: `${ISSUER}/logout`,
    }
    const fetcher: FetchLike = async () => {
      calls += 1
      return new Response(JSON.stringify(metadata), { status: 200 })
    }
    const discovery = createOidcDiscovery({ issuer: ISSUER, fetch: fetcher, clock: () => NOW })
    expect((await discovery.metadata()).tokenEndpoint).toBe(`${ISSUER}/token`)
    await discovery.metadata()
    expect(calls).toBe(1)

    const wrong = createOidcDiscovery({
      issuer: ISSUER,
      fetch: async () =>
        new Response(JSON.stringify({ ...metadata, issuer: 'https://evil.test' }), {
          status: 200,
        }),
    })
    await expect(wrong.metadata()).rejects.toBeInstanceOf(OidcUnavailableError)
  })

  test('fails closed on an error status or network failure', async () => {
    const failed = createOidcDiscovery({
      issuer: ISSUER,
      fetch: async () => new Response('no', { status: 503 }),
    })
    await expect(failed.metadata()).rejects.toBeInstanceOf(OidcUnavailableError)

    const down = createOidcDiscovery({
      issuer: ISSUER,
      fetch: async () => {
        throw new Error('offline')
      },
    })
    await expect(down.metadata()).rejects.toBeInstanceOf(OidcUnavailableError)
  })
})

describe('token exchange', () => {
  test('posts the code and PKCE verifier with basic client authentication', async () => {
    let request: Request | undefined
    const fetcher: FetchLike = async (input, init) => {
      request = new Request(input, init)
      return new Response(JSON.stringify({ id_token: 'signed' }), { status: 200 })
    }
    const result = await exchangeAuthorizationCode({
      tokenEndpoint: `${ISSUER}/token`,
      clientId: CLIENT_ID,
      clientSecret: 'secret',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://app.example.test/api/auth/callback',
      fetch: fetcher,
    })
    expect(result.idToken).toBe('signed')
    expect(request?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:secret`).toString('base64')}`,
    )
    const form = new URLSearchParams(await request?.text())
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code_verifier')).toBe('verifier-1')
    expect(form.get('redirect_uri')).toBe('https://app.example.test/api/auth/callback')
  })

  test('maps rejection, outage and malformed bodies', async () => {
    const base = {
      tokenEndpoint: `${ISSUER}/token`,
      clientId: CLIENT_ID,
      clientSecret: 'secret',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://app.example.test/api/auth/callback',
    }
    await expect(
      exchangeAuthorizationCode({
        ...base,
        fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      }),
    ).rejects.toBeInstanceOf(OidcRejectedError)

    await expect(
      exchangeAuthorizationCode({
        ...base,
        fetch: async () => new Response('{"error":"server"}', { status: 500 }),
      }),
    ).rejects.toBeInstanceOf(OidcUnavailableError)

    await expect(
      exchangeAuthorizationCode({
        ...base,
        fetch: async () => new Response('{"token_type":"Bearer"}', { status: 200 }),
      }),
    ).rejects.toBeInstanceOf(OidcUnavailableError)
  })
})

describe('ID token verification', () => {
  const nonce = 'nonce-1'

  async function keys() {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    return {
      privateKey,
      keySet: createLocalJWKSet({ keys: [{ ...jwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] }),
    }
  }

  async function token(
    privateKey: CryptoKey,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    return new SignJWT({
      email: 'Doctor@Example.test',
      email_verified: true,
      name: 'Dev Doctor',
      auth_time: Math.floor(NOW.getTime() / 1_000),
      amr: ['pwd', 'otp'],
      azp: CLIENT_ID,
      nonce,
      sid: 'session-1',
      acr: 'urn:zitadel:iam:org:project:id:1:aud',
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience([CLIENT_ID, 'project-1'])
      .setSubject('subject-1')
      .setIssuedAt(NOW)
      .setExpirationTime('5m')
      .sign(privateKey)
  }

  test('returns bounded identity claims with a strong AAL', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    const identity = await verifier.verify(
      await token(privateKey),
      hashToken(nonce),
    )
    expect(identity).toMatchObject({
      issuer: ISSUER,
      subject: 'subject-1',
      email: 'doctor@example.test',
      displayName: 'Dev Doctor',
      aal: 2,
      sid: 'session-1',
    })
  })

  test('treats a passkey alone as single-factor', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    const identity = await verifier.verify(
      await token(privateKey, { amr: ['passkey'] }),
      hashToken(nonce),
    )
    expect(identity.aal).toBe(1)
  })

  test('accepts a single-element audience array', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    const signed = await new SignJWT({
      email: 'doctor@example.test',
      email_verified: true,
      auth_time: Math.floor(NOW.getTime() / 1_000),
      amr: ['pwd'],
      azp: CLIENT_ID,
      nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience([CLIENT_ID])
      .setSubject('subject-1')
      .setIssuedAt(NOW)
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifier.verify(signed, hashToken(nonce))).resolves.toBeDefined()
  })

  test('rejects a wrong nonce, audience and expired token', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    await expect(
      verifier.verify(await token(privateKey, { nonce: 'other' }), hashToken(nonce)),
    ).rejects.toBeDefined()

    const wrongAudience = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience('other')
      .setSubject('subject-1')
      .setIssuedAt(NOW)
      .setExpirationTime('5m')
      .sign(privateKey)
    await expect(verifier.verify(wrongAudience, hashToken(nonce))).rejects.toBeDefined()

    const expired = await new SignJWT({
      email: 'doctor@example.test',
      email_verified: true,
      auth_time: Math.floor(NOW.getTime() / 1_000),
      amr: ['pwd'],
      azp: CLIENT_ID,
      nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('subject-1')
      .setIssuedAt(NOW.getTime() / 1_000 - 600)
      .setExpirationTime(NOW.getTime() / 1_000 - 300)
      .sign(privateKey)
    await expect(verifier.verify(expired, hashToken(nonce))).rejects.toBeDefined()
  })

  test('accepts a token without an authorised party or methods', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    const signed = await new SignJWT({
      email: 'doctor@example.test',
      email_verified: true,
      auth_time: Math.floor(NOW.getTime() / 1_000),
      nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('subject-1')
      .setIssuedAt(NOW)
      .setExpirationTime('5m')
      .sign(privateKey)

    const identity = await verifier.verify(signed, hashToken(nonce))
    expect(identity.amr).toEqual([])
    expect(identity.aal).toBe(1)
  })

  test('rejects a token authorised for another party', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    await expect(
      verifier.verify(await token(privateKey, { azp: 'someone-else' }), hashToken(nonce)),
    ).rejects.toBeDefined()
  })

  test('rejects malformed authentication method references', async () => {
    const { privateKey, keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    for (const amr of [['pwd', 7], [''], Array.from({ length: 17 }, () => 'pwd'), 'pwd']) {
      await expect(
        verifier.verify(await token(privateKey, { amr }), hashToken(nonce)),
      ).rejects.toBeDefined()
    }
  })

  test('rejects an unsigned alg none token', async () => {
    const { keySet } = await keys()
    const verifier = createIdTokenVerifier({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keySet,
      now: () => NOW,
    })
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ nonce })).toString('base64url')
    await expect(verifier.verify(`${header}.${payload}.`, hashToken(nonce))).rejects.toBeDefined()
  })
})

describe('authentication configuration', () => {
  const base = {
    ZITADEL_ISSUER: ISSUER,
    ZITADEL_CLIENT_ID: CLIENT_ID,
    ZITADEL_CLIENT_SECRET: 'secret',
    ZITADEL_REDIRECT_URI: 'https://app.example.test/api/auth/callback',
    ZITADEL_POST_LOGOUT_URI: 'https://app.example.test',
    SEALING_KEY: Buffer.alloc(32, 1).toString('base64url'),
  }

  test('loads the values without exposing them in errors', () => {
    expect(loadAuthConfig(base).sealingKey.bytes).toHaveLength(32)
  })

  test('rejects a short or malformed sealing key', () => {
    expect(() =>
      loadAuthConfig({ ...base, SEALING_KEY: 'short', ZITADEL_CLIENT_SECRET: 'hunter2' }),
    ).toThrow(AuthConfigError)
    try {
      loadAuthConfig({ ...base, SEALING_KEY: 'a'.repeat(43) })
    } catch (error) {
      expect(String(error)).not.toContain('a'.repeat(43))
    }
  })

  test('requires https for every production URL', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      ZITADEL_ISSUER: 'https://identity.example.test',
      ZITADEL_REDIRECT_URI: 'https://app.example.test/api/auth/callback',
      ZITADEL_POST_LOGOUT_URI: 'https://app.example.test',
    }
    expect(loadAuthConfig(production).issuer).toBe('https://identity.example.test')
    expect(() =>
      loadAuthConfig({ ...production, ZITADEL_REDIRECT_URI: 'http://app.example.test/callback' }),
    ).toThrow(AuthConfigError)
  })

  test('rejects an http endpoint from an https discovery document', async () => {
    const discovery = createOidcDiscovery({
      issuer: 'https://identity.example.test',
      fetch: async () =>
        new Response(
          JSON.stringify({
            issuer: 'https://identity.example.test',
            authorization_endpoint: 'http://identity.example.test/authorize',
            token_endpoint: 'https://identity.example.test/token',
            jwks_uri: 'https://identity.example.test/jwks',
          }),
          { status: 200 },
        ),
    })
    await expect(discovery.metadata()).rejects.toBeDefined()
  })
})