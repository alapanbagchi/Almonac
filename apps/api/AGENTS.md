# Almonac API — Elysia on Bun

**Status: authentication and admin plane.** `apps/api` is an Elysia 2 (`2.0.0-rc.1`) service on Bun: `GET /health` and `GET /health/ready`, the error-envelope plugin, OpenAPI at `/openapi`, startup configuration validation, a bounded control PostgreSQL pool, SQL migrations for the `identity`, `control` and `audit` schemas (issuer-scoped identities, OIDC session metadata, invitations, tenancy, scoped roles and template versions, membership history, break-glass review and a catalogued append-only audit log), and a least-privilege `almonac_app` runtime role. Unit and integration tests cover the foundation.

OpenID Connect authentication is implemented on `/v1/auth`: login-attempt start, callback exchange, step-up, session read and logout. The API owns the flow, verifies the ID token once, and issues an opaque server-side session token; the web app relays the authorization code and state and sets the cookie. Bearer authentication is enforced on the session and logout routes and reads the session, user, memberships and permissions. First-party credential entry is implemented (ADR-016): `POST /v1/auth/register` stores a pending registration with a bcrypt hash and a token hash, `POST /v1/auth/verify-email` consumes it and creates the Zitadel user with a verified address, and `POST /v1/auth/password-login` creates a Zitadel session through the login client and returns a callback URL. No identity exists before the address is verified, and the hosted login is not part of a normal sign-in. `POST /v1/onboarding/organisation` creates the caller's first organisation, instantiates the role catalogue, makes the caller its organisation administrator and audits the change. The admin plane on `/v1/admin` provisions organisations through the Zitadel management API, manages hospitals and domains, invitations, memberships and roles, and reads the audit log. Tenant resolution, permission guards on clinical domain routes, hospital databases and domain features are not implemented yet. Everything below is the intended architecture, binding on whoever implements it. Before writing code, check the Elysia version and read that version's documentation; do not copy examples from an older release.

The API is a modular monolith owning the Control, Hospital and Terminology domains. It authorises every request, resolves the tenant, and is the only service that talks to PostgreSQL.

## 1. Layout

```text
apps/api/src/
├── index.ts                 process entry: config, adapters, routers, shutdown
├── app.ts                   composition root (exports App for Eden)
├── config.ts                startup configuration
├── routes/                  <area>.router.ts: paths, schemas, one controller call
├── controllers/             use cases: (dependencies, actor, values) => DTO
├── repositories/            factories over DatabaseQuery: SQL and row mapping
├── guards/                  bearer auth, admin context, assurance policy
├── adapters/                Zitadel, OIDC, SMTP
├── shared/                  errors, audit writer, authorisation, pagination
├── plugins/                 errors, security headers, openapi
└── db/                      pool, transactions, migrations, column readers
```

The control plane arrived flat, and stays flat. The `domains/<domain>/<feature>/`
split is the target when a feature has a hospital or terminology counterpart to
sit beside; creating `domains/control/` for the whole control plane today would
nest every folder one level deeper without separating anything, and
`domains/hospital/` and `domains/terminology/` would be empty. Move a feature
into `domains/` when the second domain lands, in one commit that touches only
moves and imports.

Three layers, named by the job they do:

| Layer | Responsibility | Must not contain |
| --- | --- | --- |
| `routes/<area>.router.ts` | Elysia instance, paths, `t` schemas, status codes, one call into a controller | SQL, authorisation policy, business rules |
| `controllers/<area>/<verb>-<noun>.ts` | One use case: load, authorise, apply rules, write and audit in a transaction | `Context`, `Request`, headers, cookies, SQL, status codes |
| `repositories/<aggregate>-repository.ts` | Queries for one aggregate over an injected `DatabaseQuery`, row mapping, constraint translation | `withTransaction`, authorisation, mail, status codes |

A controller is a plain function, not a class. It takes the capabilities it needs (`db`, `transaction`, `authorize`, `clock`) and plain values; never a pool it opens itself. A repository factory is the only place SQL text lives, and it works inside or outside a transaction because the caller passes the query handle.

Visibility is explicit: `d.authorize(actorId, permission, target)` inside the use case, after the row is loaded, because a client-supplied id selects a resource but never proves access. Errors are thrown as domain types and answered once in `plugins/errors.ts`; a controller never maps to HTTP.

Schemas live in the router and describe the **API contract**, not the database. A column rename must not silently change a response shape; map explicitly in the controller's response file.

Do not add classes for services, `BaseRepository` hierarchies, a `validators/` directory, or a singleton bundle of repositories. Router factories take a dependency object and mount with `.use()`.

## 2. Native Elysia conventions

- `new Elysia({ name, prefix, tags })` per feature; `name` must be unique and stable — it is the deduplication key.
- `.use(plugin)` to compose. A plugin's hooks, schemas and decorators do **not** flow to the consumer by default; only `decorate`/`state` values do. Do not assume `.use(auth)` protects the parent's routes.
- Scope: `local` (default) protects this instance and its descendants; `scoped` also applies to the parent that mounts it; `global` applies to every instance that mounts it. Choose the narrowest scope that protects the intended routes, and write down why.
- Lifecycle order: request → parse → transform → validation → beforeHandle → handler → afterHandle → mapResponse → onError → afterResponse. Derived context exists from `transform` onward; `.resolve()` runs **after** validation, which is where tenant resolution belongs when it reads validated params.
- `.decorate()` for stateless singletons (config, clock, id generator). `.derive()` for request-scoped values computed before validation. `.resolve()` for request-scoped values that need validated input. Never put mutable per-request or per-tenant state in a module-level variable or plugin decorator.
- `.guard({ as: 'scoped' }, ...)` for route-group policy. Never hide a route from OpenAPI to avoid protecting it.
- Validate params, query, body and response with `t`. Response schemas are contracts: do not use `t.Any()` to escape a mismatch; fix the shape.
- Errors: throw typed errors in services; map them once in a root `onError` handler to `{ error: { code, message, requestId } }`. Never return raw exception messages.
- OpenAPI: register the OpenAPI plugin once at the root; every route gets `detail.summary`, a tag and explicit security. Generated docs are part of the deliverable.
- Eden Treaty: export `type App` from `app.ts` for the web client. Do not hand-write request/response types that Eden already infers.

Minimal feature:

```ts
// routes/patients.router.ts
import { Elysia, t } from 'elysia'
import { listPatients } from '../controllers/patients/list-patients'
import { patientListQuery, patientSchema } from './schemas'

export function patientsRouter(d: PatientDependencies) {
  return new Elysia({ name: 'hospital.patients', prefix: '/patients', tags: ['Patients'] })
    .get('/', ({ actor, query }) => listPatients(d, actor, query), {
      query: patientListQuery,
      response: t.Object({ patients: t.Array(patientSchema) }),
      detail: { summary: 'List patients in the current hospital' },
    })
}
```

```ts
// controllers/patients/list-patients.ts — plain arguments, no Context
export async function listPatients(d: PatientDependencies, actor: Actor, query: PatientListQuery) {
  await d.authorize(actor.id, 'patient.read', { organisationId: actor.organisationId })
  return { patients: await createPatientRepository(d.db).list(actor.organisationId, query) }
}
```

## 3. Composition

```ts
// app.ts (composition root)
import { Elysia } from 'elysia'
import { errors } from './plugins/errors'
import { openapi } from './plugins/openapi'
import { patientsRouter } from './routes/patients.router'

export function createApp(dependencies: AppDependencies) {
  return new Elysia({ name: 'almonac.api' })
    .use(errors)
    .use(openapi)
    .use(patientsRouter(dependencies.patients))
}

export type App = ReturnType<typeof createApp>
```

`index.ts` loads configuration, builds the adapters and repositories, calls
`createApp`, opens the port and closes both on shutdown. Tests call `createApp`
with fakes.

Each router mounts itself with its prefix and `.use(adminGuard(d))` when the
area needs an actor. A router never mounts another router; `app.ts` composes
them. Admin routers nest under one `new Elysia({ name: 'admin.routers' })` so
the guard's derived context is shared.

API versioning and the root path are **not decided** for new features (see ADR-003 and `docs/architecture/unresolved-decisions.md`, U-15). The authentication routes use `/v1/auth` because accepted ADR-012 names those paths. Do not extend `/v1` to another feature before the decision; keep feature prefixes relative so the mount point stays a one-line change.

## 4. Authentication and authorisation

```text
Request → authenticate (session/token) → resolve hospital (registry + header/route)
        → verify active membership → evaluate permission → route → service → repository
        → hospital pool → hospital database
```

- The hospital ID is a selector. Access requires an active membership row for the authenticated user in that hospital, checked server-side per request.
- Organisation membership grants no clinical access. Platform administration grants no clinical access. Both need an explicit hospital grant.
- Permissions are checked in the route's guard or the service entry point for every protected operation — list, read, create, update, delete, export and download alike. A detail route is not "already covered" by its list route.
- Put the check in one reusable guard plugin and call it per feature; do not rely on a hook in a sibling plugin leaking across.
- Denials return 403 without revealing whether the record exists. Cross-hospital lookups return 404, not 403, where existence itself is sensitive.
- Never trust a role or hospital ID supplied in the body. Read identity from the authenticated session and tenant from the resolved context.
- The policy engine is unresolved (RBAC with contextual checks is the baseline). Do not introduce a policy DSL or an external authorisation service without an ADR.

## 5. Tenant database management

- Tenant metadata lives in the control DB: hospital ID, database identifier, secret reference, schema version, status. It is written only by provisioning.
- Resolve the hospital from the registry, load credentials from the secret manager, and use a **pre-created pool per hospital**. Never build a connection string from a client value.
- Pools are keyed by hospital ID, bounded (max connections per hospital), and evicted when idle. A request must not create a pool as a side effect.
- Each hospital has its own database role, granted only on its own database. Application roles are never database owners, never superusers and never have `CREATEDB`/`CREATEROLE`.
- Restrict `CONNECT` on each hospital database to its role (revoke the default `PUBLIC` grant), keep `public` schema privileges minimal, and set a safe `search_path`.
- One transaction per unit of work, opened on the tenant's pool; never hold a transaction open across an HTTP call.
- On connection failure, fail the request with 503 and a request ID. Do not retry writes blindly; reads may retry once with backoff.
- Never reuse a pool or transaction across hospitals, and never keep a "current tenant" in a global.

## 6. Terminology

Terminology routes read only the terminology database. Clinical features call the terminology service/API for concepts and mappings; they do not join across databases and do not copy terminology tables into hospital databases. Store the stable concept identifier plus source and version on clinical records, so display does not require a live lookup. Hospital-specific formulary and preferences live in hospital storage.

## 7. Errors

| Situation | Status | Code |
| --- | --- | --- |
| Schema validation | 400 | `VALIDATION_FAILED` |
| No/invalid session | 401 | `UNAUTHENTICATED` |
| Not a member, missing permission | 403 | `FORBIDDEN` |
| Unknown or out-of-tenant resource | 404 | `NOT_FOUND` |
| State conflict, duplicate | 409 | `CONFLICT` |
| Business rule rejected | 422 | `RULE_VIOLATION` |
| Database/upstream unavailable | 503 | `UNAVAILABLE` |
| Anything unexpected | 500 | `INTERNAL` |

Log the cause with a request ID server-side; return only the code, a safe message and the request ID.

The table above is the vocabulary for failures. New endpoints use those codes; do not add a code per resource or per rule. A client that needs to distinguish one rule from another reads the message, and the structured log carries the detail the message omits. The exceptions in code are deliberate and closed:

| Code | Status | Why it stays |
| --- | --- | --- |
| `MFA_REQUIRED` | 403 | The caller is authenticated; the client must complete a second factor and retry, not request access. |
| `STEP_UP_REQUIRED` | 403 | Same reason: the browser rotates the session and retries instead of showing a denial. |
| `RATE_LIMITED` | 429 | The status itself is the contract; the code lets the client read `Retry-After` for a busy form. |
| `INVALID_EMAIL` `INVALID_NAME` `INVALID_PASSWORD` `EMAIL_VERIFICATION_INVALID` | 422 | Form field errors: the client keys a message onto the field that failed and the rule does not fit "business rule rejected". |
| `REGISTRATION_REJECTED` | 422 | The sign-up itself is refused; no resource exists to name in the generic message. |
| `MAIL_UNAVAILABLE` `AUTH_UNAVAILABLE` | 503 | Says which dependency failed so the operator and the client can tell a retry from a broken account. |

Never include SQL, table names, stack traces, secrets or patient data.

## 8. Testing

- Service unit tests: business rules, invariants, error paths; no HTTP, no database.
- Repository tests: real PostgreSQL (container or dedicated test DB) with migrations applied; verify tenant scoping in every query.
- Route tests: `app.handle(new Request(...))` for status, schema and error mapping.
- Permission matrix tests: each role × each protected operation, allowed **and** denied.
- Cross-hospital isolation tests: hospital A's credentials against hospital B's IDs must 404/403 and never return data.
- Contract test: OpenAPI generation succeeds and Eden types compile against the web client.

A route is not done when it returns 200. It is done when the denial cases are tested.

## 9. Before you finish

Type-check, lint, tests and `openapi` generation pass; every new route has a summary, tag and security entry; every new query is tenant-scoped; the diff contains no `t.Any()`, no raw SQL string built from request input, and no new global state. Report anything you could not verify.