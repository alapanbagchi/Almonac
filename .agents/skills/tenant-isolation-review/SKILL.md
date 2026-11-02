---
name: tenant-isolation-review
description: Use when reviewing multi-tenant isolation in Almonac — before merging a feature that touches hospital data, after adding a query or endpoint, during a security review, or when investigating suspected cross-tenant data exposure. Audits authentication, tenant resolution, authorisation, query scoping, caches, jobs and storage.
---

# Tenant isolation review

Almonac is multi-tenant per hospital. One hospital must never read, infer or affect another hospital's data. Isolation is a property of the whole request path, not of a `where` clause, so this review follows data from the request to the response and back.

This skill produces a review report. It does not silently fix everything it finds — separate confirmed violations (fix now) from hardening suggestions.

## Scope

Review one of:

- A feature or endpoint set (the default), or
- A repository/domain, or
- The whole API before a milestone.

State the scope in the report. "Reviewed patients endpoints in `domains/hospital/patients` at commit abc123" is useful; "reviewed the app" is not.

## 1. Inventory the attack surface

List every route in scope with method, path, permission, and where the hospital/tenant comes from:

| Method | Path | Permission | Tenant source |
| --- | --- | --- | --- |
| GET | /hospitals/:hospitalId/patients | `patient.read` | path param, verified |
| GET | /me | — | session |

Sources of tenant identity, in order of trust: server-side session → verified membership record → validated path/query parameter as a **selector**. A client-supplied hospital ID is never trust; it is a lookup key that must be checked against the session.

Flag any route that has no tenant source and reads clinical data. That is either a global feature (control-plane, terminology) or a defect.

## 2. Authentication

- Every clinical route requires an authenticated session. Check the guard is actually applied, not merely imported.
- No route relies on the client sending a hospital header without verification.
- Tokens are validated (signature, expiry, issuer, audience) and the validation result is the only identity used.
- Unauthenticated requests return 401 before any database access.

## 3. Tenant resolution

- Resolution happens in one place (`.resolve()` or a shared guard) and produces an immutable context object.
- The context contains the hospital ID and the actor; it is passed explicitly to services.
- No module-level or global mutable tenant state, no `AsyncLocalStorage` left unset, no request-scoped cache shared across requests.
- Membership is checked for the specific hospital in the same request: does this user belong to this hospital, with an active membership?
- A suspended or removed membership fails immediately.
- When a user belongs to several hospitals, the selected hospital comes from a validated selector, never from "first membership".

## 4. Authorisation

For each route and each operation:

- The permission is the operation-specific one (`patient.read`, `note.sign`), not a broad one.
- Role checks happen server-side; hiding a button is not authorisation.
- The check covers the object, not only the collection: a user with `patient.read` in hospital A must not read patient X in hospital B.
- Denials return 403, or 404 where existence itself is sensitive. They must not return data in an error payload.
- There is no "admin bypass" that skips tenant checks; platform admins act through audited, explicit mechanisms.

## 5. Query scoping

Open every repository function touching tenant data and verify:

- The tenant predicate is present and parameterised: `where hospital_id = $1`.
- The predicate is applied in the same statement that fetches the row, not in a post-filter in JavaScript.
- Joins cannot reintroduce another hospital: a joined table either carries the same hospital key or is a global reference table.
- `update`/`delete` include the tenant predicate too — an `update ... where id = $1` is a cross-tenant write.
- Bulk operations scope every row, and batch inserts carry the hospital ID from the context, not from input.
- Raw SQL (migrations, reporting queries, `pg` calls) is checked by hand; no ORM layer will protect it.
- `findFirst`/`findUnique` by ID alone is a violation unless the tenant is part of the lookup key.
- Pagination and sorting do not allow a client to page into another tenant's rows.

## 6. Object identifiers

- IDs are not enumerable in a way that leaks: UUIDs/ULIDs preferred over sequential integers exposed to clients.
- Fetching by ID with the wrong tenant returns 404/403 and never the object.
- Responses do not include another patient's identifiers through nested relations (appointments, documents, orders) unless the relation is scoped too.
- File/object storage keys are opaque and namespaced per hospital; a signed URL is issued only after a tenant-scoped authorisation check.
- Share links, exports and PDFs are tenant-checked at generation time and expire.

## 7. Caches, queues and background jobs

- Cache keys include the hospital ID and, where relevant, the actor's permission scope.
- No cache entry is written from one tenant's request and read by another.
- Queue payloads carry the hospital ID and the consumer re-establishes tenant context; it does not trust the payload blindly.
- Jobs that iterate many hospitals do so explicitly, with per-hospital scoping, and never run an unscoped query.
- Webhooks and callbacks verify the source and resolve the tenant from the verified payload.
- Cache invalidation on membership change: removing a user's access must not leave a cached authorisation decision.

## 8. Terminology and shared reference data

- Terminology (RxNorm, SNOMED, LOINC, ICD) is intentionally shared read-only reference data. Confirm it contains no tenant data.
- Local formularies, local code mappings and local overrides are **hospital-scoped** — they look like reference data but are not.
- Any table that is a mix (global concept + hospital-specific mapping) has the mapping scoped and the concept read-only.

## 9. Logging, analytics and errors

- Logs may include hospital ID (for operations) but never PHI.
- Stack traces and validation errors are not returned raw to clients.
- Analytics/telemetry does not ship tenant or patient identifiers to third parties.
- Audit records carry the actor, hospital and target, and are queryable per hospital.

## 10. Tests that prove isolation

Isolation is only proven by tests that attempt the violation:

- Hospital A's token requesting hospital B's resource by ID → 404/403.
- Hospital A's token listing with a filter that would match hospital B data → empty.
- A user removed from a hospital loses access on the next request.
- A user with a global role but no hospital membership cannot read hospital data.
- A background job for hospital A cannot be induced to process hospital B.
- Cache test: two tenants, same logical key, different results.

Report which of these exist. Missing negative tests are a finding, even if the code looks correct.

## 11. Report

```
Tenant isolation review — <scope> — <commit>

Violations (fix before merge)
1. <file:line> — <what> — <impact> — <fix>

Risks (fix soon)
...

Verified
- <check> — <evidence/test>

Not verified
- <what> — <why, e.g. no database available>

Recommendations
- <hardening, e.g. add a repository wrapper that requires TenantContext>
```

Rules for the report:

- Cite file and line for every finding. A finding without a location is not actionable.
- Distinguish "confirmed violation" from "suspicious pattern".
- Do not claim the system is secure because no violation was found in the sampled scope; state the scope and the limits.
- If you find a live exposure (real data reachable across tenants), say so explicitly at the top and treat it as a security incident: stop, report, do not publish details into tickets before the fix.
