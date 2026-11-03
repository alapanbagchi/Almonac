import { createRemoteJWKSet } from 'jose'
import type { FetchLike } from './fetch'
import {
  createIdTokenVerifier,
  type IdTokenVerifier,
  type VerifiedIdentity,
} from './id-token-verifier'
import { createOidcDiscovery, type OidcDiscovery } from './oidc-discovery'
import { exchangeAuthorizationCode } from './oidc-token-client'
import { buildAuthorizationUrl, type AuthorizationUrlInput } from './pkce'

export interface OidcProvider {
  authorizationUrl(input: Omit<AuthorizationUrlInput, 'authorizationEndpoint' | 'clientId' | 'redirectUri'>): Promise<string>
  exchangeCode(code: string, codeVerifier: string): Promise<string>
  verifyIdToken(idToken: string, nonceHash: Buffer): Promise<VerifiedIdentity>
  endSessionUrl(idTokenHint: string): Promise<string | null>
}

export interface OidcProviderOptions {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly postLogoutUri: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly clock?: () => Date
}

/**
 * Compose discovery, the token endpoint and ID-token verification. JWKS is
 * fetched lazily and cached by jose; no token or key material is logged.
 */
export function createOidcProvider(options: OidcProviderOptions): OidcProvider {
  const discovery: OidcDiscovery = createOidcDiscovery({
    issuer: options.issuer,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  })
  let verifier: { readonly keySetUri: string; readonly value: IdTokenVerifier } | null =
    null

  return {
    async authorizationUrl(input) {
      const metadata = await discovery.metadata()
      return buildAuthorizationUrl({
        ...input,
        authorizationEndpoint: metadata.authorizationEndpoint,
        clientId: options.clientId,
        redirectUri: options.redirectUri,
      })
    },

    async exchangeCode(code, codeVerifier) {
      const metadata = await discovery.metadata()
      const result = await exchangeAuthorizationCode({
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        code,
        codeVerifier,
        redirectUri: options.redirectUri,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })
      return result.idToken
    },

    async verifyIdToken(idToken, nonceHash) {
      const metadata = await discovery.metadata()
      verifier ??= {
        keySetUri: metadata.jwksUri,
        value: createIdTokenVerifier({
          issuer: metadata.issuer,
          clientId: options.clientId,
          keySet: createRemoteJWKSet(new URL(metadata.jwksUri)),
          ...(options.clock === undefined ? {} : { now: options.clock }),
        }),
      }
      if (verifier.keySetUri !== metadata.jwksUri) {
        verifier = {
          keySetUri: metadata.jwksUri,
          value: createIdTokenVerifier({
            issuer: metadata.issuer,
            clientId: options.clientId,
            keySet: createRemoteJWKSet(new URL(metadata.jwksUri)),
            ...(options.clock === undefined ? {} : { now: options.clock }),
          }),
        }
      }
      return verifier.value.verify(idToken, nonceHash)
    },

    async endSessionUrl(idTokenHint) {
      const metadata = await discovery.metadata()
      if (metadata.endSessionEndpoint === null) return null
      const url = new URL(metadata.endSessionEndpoint)
      url.searchParams.set('id_token_hint', idTokenHint)
      url.searchParams.set('post_logout_redirect_uri', options.postLogoutUri)
      url.searchParams.set('client_id', options.clientId)
      return url.toString()
    },
  }
}