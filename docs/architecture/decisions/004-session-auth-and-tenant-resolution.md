# ADR-004: Server-side sessions, membership-checked tenant resolution

- **Status:** Proposed (nothing implemented)
- **Date:** 2026-11-03
- **Deciders:** Backend, Security, Frontend
- **Related:** ADR-001, ADR-002, skill `tenant-isolation-review`

## Context

Every clinical request needs two facts: **who** is acting, and **which hospital** they are acting in. The second is the dangerous one. If the hospital is taken from the request body, a forged header or an unverified path segment, the API becomes a confused deputy: it holds credentials for every hospital and will happily use them on the caller's behalf.

We also need logout that actually revokes, session expiry that is enforced server-side, and a way for a clinician working at two hospitals to switch context deliberately.

## Decision

- **Opaque server-side sessions.** A random session token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. The server stores session state (user, expiry, creation time, last rotation) and can revoke it. No long-lived JWT in `localStorage`.
- **Membership is checked per request.** The session identifies the user; the hospital comes from a validated selector (path parameter or a request-scoped selection); the server then verifies an active membership row for that user and hospital. The selector is a lookup key, never evidence.
- **Tenant context is resolved once**, in a shared `.resolve()`, and passed explicitly to services as an immutable object (`{ hospitalId, actorId, permissions }`).
- **Permission checks are operation-specific** (`patient.read`, `note.sign`), evaluated against the resolved membership.
- **Denials do not leak existence**: 403 for a known resource the actor cannot access where visibility is not sensitive, 404 for cross-tenant lookups.
- **Platform administrators** use a separate, audited break-glass path. There is no implicit "admin sees all" branch inside hospital routes.

## Consequences

Positive:

- Revocation is immediate: deleting the session row ends access.
- The hospital cannot be smuggled in through the body; a request without a valid membership fails before any repository call.
- Session state can carry the active hospital, so switching is explicit and auditable.
- Frontend and API share one notion of identity; the frontend never decides authorisation.

Negative:

- A session store is required (PostgreSQL table or Redis), and it becomes a dependency of every request.
- CSRF must be handled explicitly for cookie-based auth (SameSite plus a double-submit token for state-changing requests).
- Horizontal scaling requires the session store to be shared, not in-memory.

## Alternatives considered

- **JWT access tokens with hospital claim.** Stateless and convenient, but revocation is delayed until expiry, and a hospital claim minted at login goes stale when a membership is removed. Rejected for clinical access.
- **Hospital ID in a header, verified by middleware only.** Easy to add a route that skips the middleware. Rejected; resolution belongs in a single enforced plugin.

## Follow-ups

- Choose the session store and the idle/absolute timeout values (a clinical workstation should not stay unlocked indefinitely).
- Define the break-glass flow: who may request it, how long it lasts, what is audited, who is notified.
- Decide whether multi-hospital users select a hospital per session or per request; the UI currently assumes a single active hospital.
