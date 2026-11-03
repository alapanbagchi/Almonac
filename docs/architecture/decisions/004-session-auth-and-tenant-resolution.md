# ADR-004: Server-side sessions and membership-checked tenant resolution

- **Status:** Proposed (nothing implemented. ADR-012 amends the transport.)
- **Date:** 2026-11-03
- **Amended:** 2026-11-03. ADR-012 defines the cookie and Bearer split and the OIDC flow.
- **Deciders:** Backend, Security, Frontend
- **Related:** ADR-001, ADR-002, ADR-010, ADR-012, skill `tenant-isolation-review`

## Context

Each clinical request must identify two things: the actor and the hospital. The hospital value is dangerous. A request body, header or path can contain a false hospital ID. If the API trusts that value, it can use its own credentials to read another hospital. The API must prove access on the server.

The system also needs logout that revokes access, expiry that the server enforces, and a clear way for a clinician to switch hospitals.

## Decision

- **Use opaque server-side sessions.** Create a random session token. Store only its hash in the control database. Store the user, expiry, creation time, rotation time and revocation state on the server. The browser must not hold a JWT or a refresh token.
- **Use a cookie at the web origin and Bearer on the private hop.** The Next.js backend for frontend (BFF) sets the `__Host-almonac_sid` cookie with `HttpOnly`, `Secure` and `SameSite=Lax`. The BFF sends the opaque token to the API as `Authorization: Bearer`. The API must not read cookies. The cookie belongs to the web session, not to the API credential. See ADR-012.
- **Check membership on every request.** The session identifies the user. The hospital comes from a validated selector, such as a path parameter or a request-scoped selection. The server then checks for an active membership row for that user and hospital. The selector is a lookup key only. It is not proof of access.
- **Resolve tenant context once.** A shared `.resolve()` resolves the tenant. It passes an immutable object to services: `{ hospitalId, actorId, permissions }`.
- **Check operation permissions.** Each operation has a permission key, for example `patient.read` or `note.sign`. The server evaluates the key against the resolved membership.
- **Do not reveal existence in denials.** Return 403 for a known resource that the actor cannot access, but only when its existence is not sensitive. Return 404 for cross-tenant lookups.
- **Use a separate break-glass path for platform administrators.** This path is audited. Hospital routes must not contain an implicit "admin sees all" branch.

## Consequences

Positive:

- Revocation is immediate. A deleted session row ends access.
- A false hospital ID cannot grant access. A request without an active membership fails before any repository call.
- The session can hold the active hospital. A switch is explicit and auditable.
- Web and API use one identity model. The frontend never makes an authorisation decision.

Negative:

- Every request depends on a session store. ADR-012 selects a PostgreSQL table in the control database and rejects Redis.
- The BFF must handle CSRF for cookie-authenticated state-changing routes. It uses `SameSite` and an origin check. The API uses Bearer tokens only and is not exposed to CSRF.
- Horizontal scaling requires a shared session store. An in-memory store is not sufficient.

## Alternatives considered

- **JWT access tokens with a hospital claim.** This is stateless and convenient. Revocation is delayed until expiry. A hospital claim also becomes incorrect when a membership is removed. Rejected for clinical access. ADR-012 keeps the ID token at the login boundary only.
- **Hospital ID in a header, checked by middleware only.** A developer can add a route that skips the middleware. Rejected. Resolution belongs in one enforced plugin.

## Follow-ups

- Choose the idle and absolute timeout values. A clinical workstation must not stay unlocked without limit. ADR-012 proposes 15 minutes idle and 8 hours absolute, pending clinical and security approval.
- Define the break-glass flow. Record who can request it, how long it lasts, what is audited and who is notified.
- Decide whether multi-hospital users select a hospital per session or per request. The current UI assumes one active hospital.
- Implement the cookie and Bearer split and the API-owned OIDC flow as ADR-012 specifies. Do not add a cookie-reading API guard.
