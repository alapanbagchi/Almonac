# ADR-008: Bun runtime, `pg` with SQL migrations, no ORM

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Architecture, Backend, Database
- **Related:** ADR-002, ADR-003, `database/AGENTS.md`
- **Resolves:** U-02 and the tool choice in U-10

## Context

ADR-003 chose Elysia, which runs on Bun. The database handbook was written defensively — it described Prisma rules "if adopted" and left the query layer and migration tool undecided — because nothing was installed. The result was documentation that could be read as endorsing an ORM that does not exist, and a runtime question that blocked container and CI decisions.

Three things needed a decision: the API runtime, how the API talks to PostgreSQL, and how schema changes are applied to every hospital database.

## Decision

**Runtime: Bun** for `apps/api` and `apps/worker`. Python/FastAPI remains the `apps/clinical-ai` runtime.

**Persistence: `pg` (node-postgres), no ORM.** Repositories are the only place SQL lives. Queries are parameterised, tenant-filtered, and return rows that the repository maps to domain types explicitly. Compile-time safety comes from TypeScript types declared next to the query plus runtime validation at the module boundary; there is no generated client and no schema-first query builder.

**Migrations: SQL files applied by `node-pg-migrate`.** One migration directory per plane (`control`, `hospital`, `terminology`); the same hospital migration set is applied to every hospital database, tracked per database.

## Consequences

Positive:

- The stack matches the code already documented (ADR-003 shows `tenant.db.query(...)`), so there is no Prisma/ORM layer to invent.
- SQL is reviewable: the tenant predicate, joins and indexes are visible in the diff, which matters most for clinical queries.
- No ORM migration engine between the schema and the database; `node-pg-migrate` applies plain SQL and can be inspected.
- Bun removes a build/transpile layer for Elysia and matches the framework's native runtime.

Negative:

- No generated types from the schema: column renames are caught by tests, not the compiler. Mitigated by repository-level row types and integration tests.
- Hand-written mapping is repetitive; a shared query helper may be needed, carefully (helpers must not hide the tenant filter).
- Bun's ecosystem has gaps for some native modules; a dependency requiring Node-only APIs must be checked before adoption.
- `node-pg-migrate` is a Node tool; running it under Bun must be verified before CI depends on it, or it runs under Node in the migration job.

## Alternatives considered

- **Prisma.** Strong types and migrations, but a generated client, a second schema language, and per-tenant client/pool plumbing that is awkward for database-per-hospital. Rejected; if adopted later it requires a new ADR.
- **Drizzle.** SQL-like with types, closer to the chosen model, but adds a query builder and its own migration story while the codebase already assumes raw SQL. Not chosen; can be reconsidered when repositories exist.
- **Node with `@elysiajs/node`.** Viable and removes the two-runtime split, but gives up Elysia's native performance path. Rejected for the API; the worker may still run on Node if a dependency forces it, and that does not change this ADR for the API.

## Follow-ups

- Verify `node-pg-migrate` under Bun (or run it under Node in the migration job) before wiring CI.
- Decide the typed-row strategy: hand-written row interfaces vs a light codegen step from the live schema.
- Add SQL formatting/linting to CI so hand-written SQL stays consistent.
