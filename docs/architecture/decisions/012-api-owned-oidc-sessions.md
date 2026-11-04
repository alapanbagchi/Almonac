# ADR-012: API-owned OIDC sessions and a thin web BFF

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Backend, Security, Frontend
- **Related:** ADR-004, ADR-010, ADR-011

## Context

The web app uses Next.js. The API uses Elysia on Bun. The identity provider is Zitadel (ADR-010). The login flow must be safe in a clinical environment, simple to review and consistent with the repository boundary. `AGENTS.md` section 5 forbids the web app from holding database clients or API internals.

A common OIDC design puts the full flow in Next.js. Next.js generates the state, nonce and Proof Key for Code Exchange (PKCE) values. It exchanges the code, stores tokens, refreshes them and calls the API with a Zitadel access token. This design has three problems:

1. The web app becomes a token store. Refresh tokens, the client secret and session state live in the Next.js process. That process is close to the browser and outside the audited API boundary.
2. The API must verify a Zitadel JSON Web Token (JWT) on every request. This adds a JWKS dependency to each request and delays revocation until token expiry. It also splits authorisation across two services.
3. It duplicates session functions that the API needs for membership, tenant resolution and break-glass.

The alternative is a backend for frontend (BFF). The API owns the OIDC flow and the Almonac session. Next.js only relays the browser through the API.

## Decision

### Flow

1. The browser opens `/api/auth/login` on the web app.
2. The web app calls `POST /v1/auth/login-attempts` on the API.
3. The API creates a `login_attempt` row. The row contains the state (stored as a hash), nonce, AES-GCM encrypted PKCE verifier, validated internal `returnTo`, purpose (`login` or `step_up`), a 10-minute expiry and client metadata. The API returns the authorization URL and its expiry.
4. The web app redirects the browser to the authorization URL.
5. Zitadel authenticates the user with a password, MFA or passkey. It redirects the browser to `/api/auth/callback?code&state` on the web app.
6. The web app forwards `code` and `state` to `POST /v1/auth/callback` on the API.
7. The API consumes the attempt in one atomic update. It exchanges the code at the token endpoint with the client secret. It verifies the ID token. It creates or updates `app_user` by `zitadel_sub`. It checks the account status. It activates a pending invitation when one matches. It creates a session, writes an audit record and returns `{ token, expiresAt, returnTo }`. `expiresAt` is the absolute session expiry, not the idle expiry.
8. The web app sets the session cookie and redirects the browser to the validated `returnTo`.
9. On later requests, the web server sends `Authorization: Bearer <token>` to the API.
10. The API hashes the token, loads the session, user, memberships and permissions.

### API responsibilities

- `POST /v1/auth/login-attempts` creates a login attempt. It returns the authorization URL and expiry.
- `POST /v1/auth/callback` consumes the attempt, exchanges the code, verifies the ID token, updates the user, checks access, activates an invitation and creates a session. It audits the result.
- `POST /v1/auth/logout` revokes the current session and audits the action. It returns a Zitadel `end_session_endpoint` URL built from the encrypted `id_token_hint`. A missing or malformed token returns `401 UNAUTHENTICATED`. An unknown token returns no provider URL. An expired or already revoked token still returns the provider URL, so a shared workstation also ends the Zitadel single sign-on session. A second logout does not write a second audit record.
- `GET /v1/auth/session` returns the current user, active memberships and the union of permissions. It never returns tokens or data from another tenant. The response is informational. It is not the authorisation decision for a protected route, because a membership can change between its two queries. Every protected route must resolve access again.
- A Bearer guard resolves `Authorization: Bearer <opaque token>` on every protected route. A missing or malformed token, and an unknown, expired or revoked token, both return `401 UNAUTHENTICATED`. Distinguishing the two would tell an unauthenticated caller whether a token had ever existed. The API never reads cookies.

### Session model

- The session token is 32 random bytes, encoded as base64url. The API stores only its SHA-256 hash. The plaintext exists in the API response once and in the web cookie.
- `identity.web_session` stores `id`, `user_id`, `token_hash` (unique), encrypted `id_token_hint`, `amr` (authentication methods references), `auth_time`, `aal` (authenticator assurance level), `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `ip` and `user_agent_hash`. It has no refresh token column.
- The idle timeout is **15 minutes**. The absolute lifetime is **8 hours**. These are provisional defaults. They are configuration values and need clinical and security approval before production. This ADR does not claim that they are clinically approved.
- The API updates `last_seen_at` at most once per 60 seconds for each session. This prevents a database write on every request.
- Revocation is a row update and takes effect immediately. A step-up revokes the old row and creates a new token. The old token never works again.
- A new login always creates a new session. The API does not reuse an existing session for the same user.
- The assurance level is derived from `amr`. `mfa` gives AAL 2. A password plus one of `otp`, `hwk`, `swk`, `webauthn` or `passkey` gives AAL 2. Any other combination is AAL 1. A passkey alone is single-factor.
- The provider can report an authentication time up to 60 seconds ahead of the API clock. The login service clamps such a value to the login time so the session timestamp stays ordered.

### Cookie at the web origin

- The cookie name is `__Host-almonac_sid`. The attributes are `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`. It has no `Domain` attribute.
- The token never appears in a URL, `localStorage`, `sessionStorage`, an analytics event or a client bundle.
- The web app sets and clears the cookie. The API never sets it.

### Web BFF responsibilities

- `GET /api/auth/login` calls the API login-attempt endpoint. It redirects to the returned authorization URL with `Cache-Control: no-store`.
- `GET /api/auth/callback` forwards `code` and `state` to the API. On success, it sets the cookie and redirects to the validated `returnTo`. On failure, it redirects to a generic login error. It does not log the code or state.
- `POST /api/auth/logout` checks the request origin and calls the API. It clears the cookie even if the API call fails. It then redirects to the Zitadel end-session URL when the API returns one.
- Server components read the session through a server-only helper. The helper forwards the Bearer token with `cache: 'no-store'`. The browser bundle never receives the token.
- The web app holds no Zitadel client secret, no refresh token and no database connection.

### Step-up

- A protected action that needs fresher or stronger authentication starts a login attempt with `purpose=step_up`, `prompt=login` and `max_age=0`.
- The callback must return the same `zitadel_sub` as the current session. On success, the API rotates the session token and records the new `amr`, `auth_time` and `aal`.
- The old token stops working immediately. A stolen token from before the step-up cannot be used after elevation.

### Logout

- Local revocation comes first. The Zitadel end-session call is best effort. If Zitadel is unreachable, the Almonac session is still revoked.
- The end-session URL uses the encrypted `id_token_hint` and the registered post-logout URI. The web app clears the cookie and then redirects the browser.
- The initial implementation does not rely on back-channel logout from Zitadel. If a later phase adds it, the API must authenticate the logout token and revoke by `sid` or subject. It must not accept an unauthenticated request.

### Failure rules

- A repeated `state` is rejected. Consuming the attempt is one atomic update, so only one callback can consume it.
- A failed code exchange, ID-token verification, user-status check or invitation check creates no session. The API returns a generic `401 UNAUTHENTICATED`. It logs internal detail without the code, token or claims.
- `returnTo` must be an internal absolute path that starts with a single `/`. The API rejects schemes, protocol-relative paths, backslashes and control characters.
- Responses that carry a token or a redirect use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Consequences

Positive:

- The API is the only authority for sessions and authorisation. The web app cannot create access.
- Revocation is immediate. There is no JWT expiry window.
- The client secret and the session database never enter the Next.js process.
- The OIDC surface is small: one login attempt, one callback, one logout and one session read.
- Step-up and break-glass use the same session functions. They do not need a second token path.

Negative:

- The web server must reach the API for the callback and session read. The API is not a purely public stateless API.
- Next.js server rendering depends on the API for protected pages. An API outage is a login outage. The UI must show a clear error.
- The API verifies the ID token once, at login. A later deactivation at the identity provider does not invalidate an existing local session. The control database must also enforce account suspension, and high-risk actions need step-up.
- The local session can last longer or shorter than the Zitadel single sign-on session. Local access is authoritative. A full logout is the explicit end-session path.
- This design has more parts than one Next.js auth library. It has fewer parts than a token-refresh design split across two services.

## Alternatives considered

- **Auth.js or NextAuth in the web app.** This is fast to start. It puts token storage and refresh in Next.js, invites a second authorisation model and does not give the API a revocable session without extra work. Rejected.
- **Web-owned OIDC with refresh tokens in the control database.** This violates the web and API boundary and stores refresh tokens where they are not needed. Rejected.
- **Zitadel access tokens as API bearer tokens.** Revocation is delayed until expiry, JWKS becomes a per-request dependency and the API must still check local membership. Rejected.
- **Opaque sessions without OIDC, using a custom login form.** This brings back the credential surface that ADR-010 rejected. Rejected.
- **Cookie-based API sessions.** This is simpler in a monolith. The API has a separate origin and must not read cookies. Bearer on the private hop keeps cross-site request forgery (CSRF) out of the API. Rejected.

## Follow-ups

- The local verification confirmed the token-endpoint client authentication (client secret with HTTP Basic) and the exact ID-token claims. See `docs/security/zitadel-spike.md`. Recheck these facts if the application configuration or the Zitadel version changes.
- Set the idle and absolute timeouts with clinical and security approval. Keep them as configuration, not constants.
- Define the step-up policy for each operation. Record which permissions need AAL2 or an `auth_time` within a defined number of minutes.
- Define the break-glass grant flow and its audit events (ADR-004 follow-up).
- Add a cleanup job for expired and revoked session rows.
- Decide whether Zitadel back-channel logout is necessary. If it is, define its authentication before it is enabled.
