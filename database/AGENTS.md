# Almonac Database — PostgreSQL

**Status: not implemented.** No PostgreSQL schema, migration directory or seed file exists in this repository, and no database is running. The persistence stack is decided (ADR-008): `pg` (node-postgres) with SQL migrations via `node-pg-migrate`, and **no ORM**. The rules below define the target; every concrete API reference must be checked against the version actually installed before it is used.

## 1. Three kinds of database

| Database | Contents | Access |
| --- | --- | --- |
| Control DB | Global users, organisations, hospitals, memberships, invitations, roles, permissions, tenant registry, provisioning state | API control domain; provisioning |
| Hospital DB (one per hospital) | Patients, identifiers, practitioners, departments, appointments, encounters, diagnoses, observations, allergies, medications, orders, notes, procedures, documents, billing, local formulary | API hospital domain, scoped to that hospital only |
| Terminology DB | RxNorm, SNOMED CT, LOINC, ICD, concepts, ingredients, dose forms, routes, relationships, mappings, versions, provenance | API terminology domain; imports |

Hard boundaries:

- The control DB contains **no** clinical patient records. Not "a little" patient data for convenience — none.
- A hospital DB contains no users from other hospitals and no global membership tables.
- The terminology DB never references hospital patient data, and terminology queries never join a hospital DB.
- Cross-database joins are impossible by design. Resolve across them in the API, explicitly, with authorisation at each step.
- Do not create a global patient table, a global patient index or a cross-hospital search without an approved ADR.

Separate databases in one PostgreSQL cluster share a cluster superuser, backup process, network path and failure domain. That is logical isolation, not infrastructure isolation. Do not describe it as full isolation; see ADR-002.

## 2. Naming and structure

- `snake_case` for tables, columns, indexes and constraints. Plural table names (`patients`, `encounters`, `medication_orders`). No quoted mixed-case identifiers.
- Every table has a primary key: `id uuid PRIMARY KEY` (or a documented ULID/text scheme — pick one per database and stay consistent). Never expose a sequential integer as an external identifier.
- Foreign keys are real `FOREIGN KEY` constraints with an explicit `ON DELETE` behaviour. No orphan rows, no "the application will clean it up".
- Every table has `created_at timestamptz NOT NULL DEFAULT now()` and, where rows change, `updated_at timestamptz NOT NULL`. Store UTC; render in the user's zone.
- Booleans are `boolean NOT NULL DEFAULT false`, not nullable tri-state unless "unknown" is a real clinical state.
- Money is `numeric(12,2)` plus an explicit currency column; never `float`.
- Quantities and doses are `numeric` with an explicit unit, never a bare float. A dose without a unit is a data-entry error, not a default.
- Enumerations are a Postgres enum only when the set is truly stable; otherwise a lookup table or a `text` column with a `CHECK` constraint, so adding a value does not require a type migration.
- `jsonb` is for genuinely open payloads (raw source documents, vendor payloads, extension fields), never for fields you query and constrain. A `jsonb` column must document its shape and version.
- Nullability is a decision, not a default. A nullable column means "unknown or not applicable", and the UI must render that state honestly. Do not use empty strings as null.
- Avoid reserved words and abbreviations that differ from the domain vocabulary (`encounter`, not `enc`; `practitioner`, not `doc`).

## 3. Constraints and indexes

- Enforce uniqueness in the database: `UNIQUE` on natural keys (e.g. hospital-local patient number), partial unique indexes for "one active per X" rules (`CREATE UNIQUE INDEX ... WHERE revoked_at IS NULL`).
- Add `CHECK` constraints for invariants the database can express: date ordering (`ends_at >= starts_at`), non-negative quantities, valid status transitions only where a trigger is justified.
- Index every foreign key used for lookups, and every column used in list filters and sort orders. Do not index everything — each index costs writes.
- Composite index column order follows the query: equality columns first, then range/sort.
- Partial indexes for soft-deleted or active-only queries.
- No trigram/full-text index over clinical free text without a decision on leakage — a search index is a second copy of PHI.

## 4. Transactions and concurrency

- One transaction per unit of work. A clinical write either fully commits or does not happen.
- Use explicit isolation only where needed; the default `READ COMMITTED` is usually right. `SERIALIZABLE` is justified for scheduling and inventory allocation, with retry on serialization failure.
- Never hold a transaction open across an HTTP call, a model call, a file upload or a queue publish. Write, commit, then publish, with an outbox or idempotency record for reliability.
- Use `SELECT ... FOR UPDATE` on rows being modified concurrently (bed assignment, appointment slots) instead of read-then-write races.
- Migrations that rewrite large tables use the expand/contract pattern, not a blocking `ALTER` in production.

## 5. Clinical modelling

- **Patient** is the person; **encounter** is one interaction (visit, admission, ED attendance). Do not hang clinical facts directly off the patient when they belong to an encounter, and do not lose the patient link.
- Identifiers: a patient has multiple identifiers (MRN, national ID, insurance) with a type, issuing authority and status. Never make one national identifier the primary key.
- **Medication concept** (terminology: ingredient/strength/dose form) is different from **medication product** (a packaged, labelled product) and from **medication order** (what was prescribed to this patient) and **medication administration** (what was actually given, when, by whom). Model all four; do not collapse them into one table.
- Orders carry status, prescriber, start/stop, dose, route, frequency and the terminology concept reference. Administrations reference the order and record the actual dose/time/performer.
- Diagnoses and observations reference terminology codes with the source and version captured at the time of entry; a later terminology release must not silently rewrite history.
- **Clinical notes are append-only in effect**: create a new version or an addendum, never overwrite a signed note. Signed content records author, role, timestamp and signature state. Corrections are visible as corrections.
- Records preserve authorship and timestamps at the row level and in an audit trail for anything clinically significant.
- FHIR is an interoperability boundary (import/export, external APIs). The internal schema is designed for the domain, not forced to mirror FHIR resources. Map explicitly at the boundary.

## 6. Query layer (node-postgres, no ORM)

Decided in ADR-008. There is no ORM and no generated client; SQL is written by hand in repositories.

- One migration directory per plane: `db/control/migrations`, `db/hospital/migrations`, `db/terminology/migrations`. Never one combined migration set.
- Every query is parameterised (`$1`, `$2`, …). String concatenation of SQL is a defect, including for identifiers — use `pg-format` only for reviewed identifier interpolation, never for values.
- Repositories declare a row type per query and map it to a domain type. A column rename must be caught by a test, since the compiler will not catch it.
- One pool per database per process, created once and reused; bounds set per hospital. Never a connection per request, never a module-level pool created at import time.
- Multi-statement writes use a transaction (`begin`/`commit` via a checked-out client); the transaction never wraps an HTTP call or a model call.
- Tenant scoping is still required even though the connection is per hospital. The predicate is defence in depth and a code-review signal.
- Query helpers may exist but must never hide the tenant predicate or the parameters. If a helper makes `where hospital_id = $1` invisible, it is the wrong abstraction.
- No dynamic `select *` in application queries: list the columns so schema changes surface in review.
- `node-pg-migrate` applies the SQL files. Migrations are reviewed, immutable once applied, and never edited to "fix" a production database.

## 7. Hospital migrations

- Each hospital database tracks its own migration state. A version table records what has been applied, when and by which release.
- Apply in order; never skip a migration because "it probably ran".
- Before a schema change, take a verified backup or rely on a tested PITR window; know the restore time before you start.
- Verify after: expected schema version, row counts for affected tables, constraint presence, and a smoke query.
- Rollback is not assumed. Many migrations are forward-only; write them so a failed deploy can be corrected forward. If a rollback script exists, test it.
- Success on one hospital is not global success. Report per-hospital status, and never mark a release complete while any hospital is behind.
- Run the same migration against a staging hospital first, and against a disposable database with production-shaped data.

## 8. Data lifecycle

- Development and tests use synthetic data only. Never copy production PHI into a lower environment; if realistic data is needed, generate it.
- Seed scripts are idempotent and clearly separated from migrations. They never run implicitly in production.
- Deletion of clinical records is constrained by retention and legal requirements. Prefer status/soft-delete/amendment over hard deletion, and record who deleted what and why.
- Retention periods are **not decided**; they are jurisdiction-specific and require legal review. Do not invent numbers.
- Backups are encrypted, access-controlled and restore-tested. An untested backup is not a backup.
- Audit records are append-only and retained at least as long as the records they describe; the audit store is an unresolved decision.
- Classify data: public, internal, confidential, PHI. PHI never appears in logs, analytics, test fixtures or developer laptops.

## 9. Review checklist

Every schema change answers:

1. Which database category, and does it respect the boundary?
2. What is the tenant key, and can a query accidentally omit it?
3. Are invariants enforced by constraints, not only by code?
4. What happens on delete, and is that what clinical safety requires?
5. Does it store PHI, and is every copy justified?
6. Does it capture terminology source/version where codes are stored?
7. How does it migrate across every hospital, and what is the rollback story?
8. Is the index set justified by real queries?
