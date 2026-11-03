# Almonac API

Elysia 2 service on Bun. It owns the Control, Hospital and Terminology domains.
The control database foundation is implemented: configuration validation, a
bounded PostgreSQL pool, readiness checks, SQL migrations for the identity,
control and audit schemas, and a least-privilege runtime role. The schema covers
issuer-scoped identities, OIDC session metadata, invitations, organisation and
hospital tenancy, scoped roles and templates, membership history, break-glass
review and a catalogued append-only audit log. Authentication, tenant resolution,
hospital databases and domain features are not implemented.

## Run

Requires Bun (developed on 1.4.2) and PostgreSQL 17 for the control database.

```bash
bun install
cp .env.example .env    # set DATABASE_URL and TEST_DATABASE_URL
bun run db:migrate
bun run dev             # http://localhost:3001, watch mode
bun run start           # no watch
```

The local stack in `infrastructure/local/` provides a control database on
`127.0.0.1:5433`. `PORT` defaults to `3001`.

## Check

```bash
bun run test              # unit tests; no database required
bun run test:integration  # requires TEST_DATABASE_URL
bun run test:all
bun run typecheck
bun run lint
```

The integration test migrates its database down and up, then leaves it empty.
Use a dedicated database. Never point `TEST_DATABASE_URL` at development or
production data.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe: `{ "status": "ok" }` |
| GET | `/health/ready` | Readiness probe; 503 unless the schema version and runtime privileges are correct |
| GET | `/openapi` | Scalar API reference |
| GET | `/openapi/json` | OpenAPI 3.1 document |

Feature prefixes stay relative; the root path and versioning are undecided
(`docs/architecture/unresolved-decisions.md`, U-15).

Every failure uses one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found.", "requestId": "..." } }
```

`requestId` also appears in the `x-request-id` response header.

## Migrations

Migrations are plain SQL files in `migrations/`, applied by
`node-pg-migrate` in filename order. Applied files are recorded in
`public.pgmigrations`. Do not edit a migration after it has been applied in a
shared environment; add a new one.

```bash
bun run db:migrate       # apply pending migrations
bun run db:migrate:down  # roll back one migration
```

The scripts load `apps/api/.env`. In deployment, run the CLI with
`DATABASE_URL` supplied by the environment.

Migrations own the tables and run as the migration role. The API must not use
that role. Migration `001_runtime_role` creates the `almonac_app` role, and the
pool sets `role=almonac_app` on every connection. The runtime role can read and
write identity and control data, but it cannot hard-delete identity, tenancy,
assignment-history or break-glass records, change a session's identity or
absolute expiry, or undo a revocation. It can only select from and insert into
`audit.event`, and it may insert but not change a break-glass review. It
cannot change the schema version, the role catalogue, template versions, the
audit event catalogue, platform assignments or create audit partitions.
Privileges are granted per object; the migrations set no default table privileges
and revoke the default function grant from `PUBLIC` globally, so a new function
is executable only by its owner until a migration grants the runtime role
explicitly.

Readiness fails when the connection is not `almonac_app`, the schema version is
not current, or audit `INSERT` is denied or `UPDATE`, `DELETE` or `TRUNCATE`
is allowed. A production login role is `LOGIN NOINHERIT`, is a member of
`almonac_app` only, and is never the table owner. `RESET ROLE` does not clear a
role set at connection start; `SET ROLE NONE` returns to the login role, which
has no table rights.

## Web integration

The Next.js app imports `App` from `src/app.ts` and calls the API through Eden
Treaty in `apps/web/src/lib/api/client.ts`. It reaches the API server-side only,
via `API_URL` (default `http://localhost:3001`), and exposes `GET /api/health`
as a proxy. Do not call this API from the browser.

## Layout

```text
migrations/          SQL migrations for identity, control and audit
src/
├── app.ts           composition root (exports App for Eden)
├── config.ts        startup configuration validation
├── index.ts         opens the port and owns the pool lifecycle
├── db/              control pool and migration runner
├── health/          liveness and readiness features
├── plugins/         errors, OpenAPI
└── shared/          error envelope, AppError
test/
├── unit/            no database
└── integration/     real PostgreSQL
```

Domain features follow the four-file layout in `AGENTS.md`. Read that file
before adding a route.
