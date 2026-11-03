# Almonac API

Elysia 2 service on Bun. It owns the Control, Hospital and Terminology domains.
The control database foundation is implemented: configuration validation, a
bounded PostgreSQL pool, readiness checks and SQL migrations for the identity
and control schemas. Authentication, tenant resolution, hospital databases and
domain features are not implemented.

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
```

The integration test migrates its database down and up, then leaves it empty.
Use a dedicated database. Never point `TEST_DATABASE_URL` at development or
production data.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe: `{ "status": "ok" }` |
| GET | `/health/ready` | Readiness probe; 503 when the control database is unavailable |
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

## Web integration

The Next.js app imports `App` from `src/app.ts` and calls the API through Eden
Treaty in `apps/web/src/lib/api/client.ts`. It reaches the API server-side only,
via `API_URL` (default `http://localhost:3001`), and exposes `GET /api/health`
as a proxy. Do not call this API from the browser.

## Layout

```text
migrations/          SQL migrations for identity and control
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
