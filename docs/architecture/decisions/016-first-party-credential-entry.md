# ADR-016: First-party credential entry

- Status: Accepted
- Date: 2026-11-04
- Deciders: Engineering
- Related: ADR-010, ADR-012, ADR-013, ADR-014

## Context

ADR-010 chose Zitadel as the identity provider and allowed its hosted login.
The product now requires Almonac-branded sign-up and sign-in screens. The
browser must never show the Zitadel hosted login for a normal password login.

A user that Zitadel holds in the INITIAL state cannot complete an OIDC token
exchange. Zitadel v4.20 returns `Errors.User.NotFound` from the token
endpoint for such a user, even when the password is correct, because the
userinfo query only returns active users. A user becomes active when the email
address is verified. Creating the Zitadel user at sign-up and verifying later
therefore leaves the new account unable to log in through our callback.

## Decision

The browser posts credentials to our Next.js BFF. The BFF forwards them to the
Elysia API over the private hop. The API talks to Zitadel and never stores a
plaintext password.

- **Sign-up:** `POST /v1/auth/register` stores a pending registration in
  `identity.pending_registration`: normalised email, display name, a bcrypt
  hash, a SHA-256 token hash, a 30-minute expiry, and request metadata. It
  sends a verification link to `/verify-email#token=...`. No Zitadel user
  exists yet.
- **Verification:** `POST /v1/auth/verify-email` consumes the pending row in
  one transaction and creates the Zitadel user with `isVerified: true` and the
  stored bcrypt hash. The row is marked consumed. A replay returns 422.
- **Password login:** `POST /v1/auth/password-login` starts a login attempt.
  The API uses the Zitadel login client to create a session with the login name
  and password, then asks Zitadel for the callback URL. The browser follows that
  URL through the existing `/api/auth/callback` BFF route, which exchanges the
  code and mints the opaque Almonac session (ADR-012).
- **Email:** the verification link carries the token in the URL fragment, so it
  never reaches a server log. The page removes it from the address bar before
  the POST.
- **Rate limits:** register 5, verify 10, and password login 10 attempts per
  minute per address. Register and password responses do not distinguish an
  unknown account from a wrong password.
- **No fallback:** the hosted login stays disabled for product users. A
  provider outage returns 503, not a redirect to another login surface.

The API holds the Zitadel client secret and a machine key with the login-client
role. The web app holds neither. The design keeps the provider replaceable, as
ADR-010 requires.

## Consequences

### Positive

- Every credential screen belongs to Almonac and can follow the design system.
- A custom sign-up cannot create a Zitadel identity that is unusable for OIDC.
- Passwords exist in memory only. The database holds a bcrypt hash until the
  address is verified and that row is consumed; Zitadel holds the credential.
- The login-client call is auditable and rate limited at our boundary.

### Negative

- The password crosses the BFF and the API. Both hops must use TLS, and neither
  service may log request bodies. The API already logs only sanitised names and
  request identifiers.
- Password login needs the Zitadel login client role. `IAM_OWNER` alone is not
  enough: `CreateCallback` returns 403 without it.
- The login flow depends on Zitadel's login v2 API shape, not only on standard
  OIDC. This is a provider lock-in that ADR-010 accepted for the hosted login.
- An account with MFA enabled cannot finish password login in the custom UI; the
  API returns `MFA_REQUIRED` (403). MFA enrolment and challenge screens are not
  implemented.
- An invited new user still sets the first password through the Zitadel
  initialisation page. That page is the only hosted surface that remains.

## Alternatives considered

- **Keep the hosted login.** Rejected: the product requires first-party screens.
- **Create the Zitadel user first, verify later.** Rejected: the INITIAL user
  cannot complete OIDC, and Zitadel refuses to modify an INITIAL user through
  the management API.
- **Store passwords in Almonac and use a custom identity store.** Rejected:
  duplicates ADR-010, increases the breach radius, and loses MFA and passkeys.
- **Embed Zitadel's login in an iframe.** Rejected: framing is blocked, and the
  session cookie would cross origins.

## Follow-ups

- Add MFA challenge and enrolment screens, or return to the hosted login only
  for accounts that require MFA.
- Replace the Zitadel initialisation email for invited new users with a
  first-party sign-up link bound to the invitation token.
- Add a test for a Zitadel outage during verification and during password login.
- Confirm the login-client role is granted by the deployment bootstrap, not by
  an operator (ADR-013).
