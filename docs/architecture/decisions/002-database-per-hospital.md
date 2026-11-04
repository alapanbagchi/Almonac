# ADR-002: One logical database per hospital, pooled behind the API

- **Status:** Accepted as direction. No hospital database or pool exists yet.
- **Date:** 2026-11-03
- **Deciders:** Architecture, Backend, Operations
- **Related:** ADR-001

## Context

Hospitals are independent tenants. A hospital may leave, be audited separately, need its data restored to a point in time, or require data residency in a specific region. Clinical data volume per hospital is small (thousands of patients per year), so a dedicated PostgreSQL instance per hospital would be operationally wasteful at the start.

We need isolation that is real, but not one cluster per tenant.

## Decision

Each hospital gets its own **database** (schema namespace and credentials) inside a shared PostgreSQL cluster, with a per-hospital connection pool. Not a shared schema with a `hospital_id` column as the only boundary, and not a dedicated cluster per hospital.

Concretely:

- Database name derived from the hospital's stable ID, e.g. `hospital_<shortId>`.
- Every table in a hospital database carries `hospital_id` anyway, as defence in depth and to make cross-database joins detectable.
- The API resolves the hospital from the session, then checks out a connection from **that hospital's pool**.
- A single process may hold pools for several hospitals; pools are bounded and evicted when idle.
- Migrations are applied to every hospital database by the same migration runner, tracked per database.
- Tenant context is never derived from the request body; it is derived from the authenticated session plus membership.

## Consequences

Positive:

- Isolation is structural: a query without a tenant filter cannot read another hospital's rows, because it is connected to a different database.
- Per-hospital restore, export and deletion are possible without touching other tenants.
- A noisy hospital is limited by its own pool and can be moved to its own cluster later without a schema change.

Negative:

- Connection management is the hard part: N hospitals × pools can exhaust PostgreSQL's connection limit. Mitigated by small per-hospital pools (`max: 5`), idle eviction and a hard cap, with `pgbouncer` as the escape hatch.
- Cross-hospital reporting requires fan-out and aggregation in the application, not a single SQL query.
- Migrations must be applied consistently across all databases; a partially migrated fleet is a real failure mode and needs a tracked rollout.
- Schema drift between hospital databases is possible if migrations are missed; a drift check is required.

## Alternatives considered

- **Single database, tenant column + Row Level Security.** Strong isolation if RLS is applied to every table and the session variable is set correctly, but a single misconfigured policy or a superuser connection bypasses it silently. Also makes per-hospital restore impractical. Rejected for now; revisit if hospital count makes per-database pools unmanageable.
- **Dedicated cluster per hospital.** Best isolation and per-tenant scaling, highest cost and operational load. Rejected at current scale; the per-database design can graduate to this.

## Follow-ups

- Choose the pooling strategy (`pg` pools vs `pgbouncer` in transaction mode) before the first multi-hospital deployment.
- Define the pool cap, idle timeout and the behaviour when a new hospital cannot get a connection (fail closed with 503, never fall back to another pool).
- Write the migration rollout and drift-detection procedure.
