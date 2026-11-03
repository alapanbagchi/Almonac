# Almonac API — Elysia on Bun

**Status: control database foundation.** `apps/api` is an Elysia 2 (`2.0.0-rc.1`) service on Bun: `GET /health` and `GET /health/ready`, the error-envelope plugin, OpenAPI at `/openapi`, startup configuration validation, a bounded control PostgreSQL pool, and SQL migrations for the `identity` and `control` schemas. Unit and integration tests cover the foundation. There is no authentication, session endpoint, tenant resolution, hospital database or domain feature yet. Everything below is the intended architecture, binding on whoever implements it. Before writing code, check the Elysia version and read that version's documentation; do not copy examples from an older release.

The API is a modular monolith owning the Control, Hospital and Terminology domains. It authorises every request, resolves the tenant, and is the only service that talks to PostgreSQL.

## 1. Layout

```text
apps/api/src/
├── index.ts                 process entry: config, pool, port and shutdown
├── app.ts                   composition root (exports App for Eden)
├── plugins/                 db, auth, tenant, errors, openapi
├── domains/
│   ├── control/<feature>/
│   ├── hospital/<feature>/
│   └── terminology/<feature>/
└── shared/                  errors, ids, pagination, result types
```

Every feature is a folder with exactly these four files unless a file would be empty:

| File | Responsibility | Must not contain |
| --- | --- | --- |
| `index.ts` | Elysia instance, routes, schemas, route-level hooks, submodule composition | SQL, business rules, cross-domain imports |
| `service.ts` | Business rules, orchestration, invariants, calls to repositories or other services | `Context`, `Request`, headers, cookies, SQL |
| `model.ts` | Elysia `t` request/response schemas, exported inferred types, reusable API models | Database models, ORM types, business rules |
| `repository.ts` | Persistence and queries for one aggregate, tenant-scoped | HTTP behaviour, authorisation policy, unrelated business logic |

`model.ts` describes the **API contract**, not the database. A column rename must not silently change a response shape; map explicitly in the repository or service.

Do not add Express-style controllers, a mandatory `validators/` directory, generic `BaseRepository` classes, or a use-case class per endpoint. Four files and a typed service function are the abstraction.

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
// index.ts
import { Elysia, t } from 'elysia'
import { listPatients } from './service'
import { patientListQuery, patientListResponse } from './model'

export const patients = new Elysia({ name: 'hospital.patients', prefix: '/patients', tags: ['Patients'] })
  .get('/', ({ tenant, query }) => listPatients(tenant, query), {
    query: patientListQuery,
    response: { 200: patientListResponse },
    detail: { summary: 'List patients in the current hospital' },
  })
```

```ts
// service.ts — plain arguments, no Context
import type { TenantContext } from '../../shared/tenant'
import { patientRepository } from './repository'
import type { PatientListQuery } from './model'

export async function listPatients(tenant: TenantContext, query: PatientListQuery) {
  return patientRepository.list(tenant, query) // repository applies tenant scope
}
```

## 3. Composition

```ts
// app.ts (composition root)
import { Elysia } from 'elysia'
import { errors } from './plugins/errors'
import { openapi } from './plugins/openapi'
import { control } from './domains/control'
import { hospital } from './domains/hospital'
import { terminology } from './domains/terminology'

export function createApp(dependencies: AppDependencies) {
  return new Elysia({ name: 'almonac.api' })
    .use(errors)
    .use(openapi)
    .use(control)
    .use(hospital)
    .use(terminology)
}

export type App = ReturnType<typeof createApp>
```

`index.ts` loads configuration, creates the pools, calls `createApp`, opens the
port and closes both on shutdown. Tests call `createApp` with fakes.

Each domain `index.ts` mounts its features with their own prefixes. A feature never mounts itself; only its domain does. Prefixes are relative to the domain, so a hospital feature is not reachable under the control prefix.

API versioning and the root path are **not decided** (see ADR-003 and `docs/architecture/unresolved-decisions.md`). Do not invent `/v1` or `/api` in new code before that decision; keep feature prefixes relative so the mount point stays a one-line change.

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

Log the cause with a request ID server-side; return only the code, a safe message and the request ID. Never include SQL, table names, stack traces, secrets or patient data.

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
