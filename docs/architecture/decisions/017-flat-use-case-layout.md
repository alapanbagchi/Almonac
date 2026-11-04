# ADR-017: One flat layout of routers, controllers and repositories

- Status: Accepted
- Date: 2026-11-05
- Deciders: Engineering
- Related: ADR-002, ADR-014

## Context

The API grew as feature folders (`admin/`, `auth/`, `identity/`) holding a
route file, a service and a repository. The seams were inconsistent: some
features had a service that only authorised and called one repository, others
put policy in the repository, and the admin plane carried its own error
mapping, its own context type and its own audit helper. A duplicate Zitadel
conflict surfaced as a 500 because one mapping function did not know the
provider's conflict type.

Nesting every feature one level deeper did not separate anything either: the
admin folder reached 33 files and the boundary between HTTP shape, policy and
SQL was invisible in the tree.

## Decision

The API is laid out by job, not by feature. One folder per job, flat at
`apps/api/src`:

| Folder | Holds | Never holds |
| --- | --- | --- |
| `routes/` | path, Elysia schema, status, one call | policy, SQL, transactions |
| `controllers/` | the use case: load, authorise, rules, transaction, audit | Elysia `Context`, SQL |
| `repositories/` | SQL, row mapping, constraint translation | policy, status codes, transactions |
| `guards/` | checks that need only the request | row-level permission |
| `adapters/` | Zitadel, SMTP, OIDC; translate provider errors | domain rules |
| `shared/` | generic helpers, ports, one error boundary | feature imports |

Rules that make the layout predictable:

- A controller is a plain function `(dependencies, actor, ...values)`, so a
  denial test needs three fakes and no Postgres. Elysia `Context` ends at the
  route handler.
- A repository is a factory over `DatabaseQuery`, so the same code runs
  inside and outside a transaction, and the transaction is owned by the use
  case.
- A router is a factory `xRouter(dependencies)` mounting the paths it owns.
- Errors are thrown as domain types and answered once in
  `plugins/errors.ts`. No feature maps its own errors.
- Response status codes live in the router; services and repositories never
  see `set.status`.

## Consequences

- The admin plane stops being a folder; its six slices become controllers and
  routers next to auth, break-glass, onboarding and health.
- `apps/api/AGENTS.md`'s four-file feature folder no longer describes the
  tree; the constitution's "business rules in services" now means "in the
  controller that owns the use case".
- File count rises slightly (one file per use case) while line count falls:
  duplicated mapping, guard code and the second invitation delivery path go.
- A future worker that needs the same use case imports the controller, not a
  service module. If a second caller appears, the file moves rather than the
  rule changing.
