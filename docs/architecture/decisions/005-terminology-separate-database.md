# ADR-005: Terminology in its own database, versioned and read-only

- **Status:** Proposed (nothing implemented)
- **Date:** 2026-11-03
- **Deciders:** Architecture, Clinical informatics, Backend
- **Related:** ADR-001, ADR-002, `database/AGENTS.md`

## Context

Clinical records reference codes from external systems: RxNorm for drugs, SNOMED CT for findings and procedures, LOINC for observations, ICD-10 for diagnoses. These vocabularies are large (hundreds of thousands to millions of concepts), released on their own schedule, licensed differently, and shared by every hospital.

They are also not hospital data. A hospital must not be able to modify a concept, and a concept must not be duplicated per hospital.

At the same time, hospitals do have **local** terminology: their own formulary entries, local code mappings, and display-name overrides. Those must be tenant-scoped.

## Decision

- Terminology lives in a **separate database** (`terminology`), loaded by an import job from official releases, and served **read-only** to the API.
- Every concept carries its **system** and **version**: `(system, code, version)` is the identity, not `code` alone. A clinical record stores the code, system and version it was recorded against, so a later vocabulary release does not silently change the meaning of an old record.
- Imports are versioned and idempotent: a new release is loaded alongside the previous one, validated, then activated; the old version remains readable for records that reference it.
- Hospital-local terminology (formulary, mappings, overrides) lives in the **hospital database**, references the global concept by `(system, code, version)`, and is never written into the terminology database.
- The API resolves codes through a terminology service; clinical features never hardcode a code list, and never store a free-text drug or diagnosis where a coded value is required.

## Consequences

Positive:

- Vocabulary updates do not require touching hospital data.
- Cross-version reproducibility: a note signed last year resolves the same concept today.
- Licensing and access control for licensed vocabularies are isolated in one place.
- Local customisation stays possible without polluting the shared dataset.

Negative:

- Joins across databases are impossible in SQL; the API must resolve concepts in a second query or preload the needed subset. This is a real performance constraint for list screens.
- Storage grows with every retained version; retention per vocabulary must be decided.
- Import failures are a distinct operational failure mode that can block clinical features (a drug order cannot be validated against a half-imported RxNorm).

## Alternatives considered

- **Terminology tables in each hospital database.** Simple joins, but duplicates gigabytes per tenant, makes updates N times more expensive, and invites per-hospital edits to shared concepts. Rejected.
- **External terminology server (e.g. a FHIR terminology service) only.** Attractive long-term, but adds a network dependency and licensing complexity before the first hospital exists. Not rejected permanently — the service boundary allows this to replace the database later.

## Follow-ups

- Choose the initial vocabularies and their licences (SNOMED CT requires an affiliate licence; RxNorm is US-specific). This is a legal decision, not only technical.
- Define the import validation gate and the rollback procedure for a bad release.
- Decide how list screens avoid N+1 cross-database lookups (preload by concept set, cache by version).
