# ADR-001: Separate the control plane from the hospital data plane

- **Status:** Proposed (nothing implemented)
- **Date:** 2026-11-03
- **Deciders:** Architecture, Backend, Security
- **Related:** ADR-002, ADR-004, ADR-005

## Context

Almonac serves multiple hospitals. Some data is shared by the platform — which hospitals exist, who works at them, what roles they hold, which terminology releases are imported. Most data is clinical and belongs to exactly one hospital.

Two failure modes matter:

1. A bug in a hospital-scoped query exposes one hospital's patients to another.
2. The platform's own tables become a hub that every clinical query joins through, so a tenant filter can be forgotten in an "unrelated" table.

Storing both concerns in one schema makes the second unavoidable: user, membership and patient tables sit side by side, and nothing in the schema says which is which.

## Decision

Split the backend into two planes with distinct data stores and distinct access rules:

- **Control plane** — organisations, hospitals, platform users, memberships, invitations, roles/permissions, terminology release registry. No clinical data. Accessed by platform administration and by every request's authentication, but clinical endpoints read from it only to resolve identity and membership.
- **Hospital data plane** — patients, encounters, orders, notes, appointments, documents, local formulary. Every table carries `hospital_id` and is reachable only with a validated tenant context.

In code, this is visible as domains: `domains/control`, `domains/hospital`, `domains/terminology` (shared read-only reference data, see ADR-005). A domain may call another domain's **service**, never its repository.

## Consequences

Positive:

- A missing tenant filter is a bug in a small, reviewable area rather than anywhere in the schema.
- Access to clinical data requires two independent things: a session and a resolved hospital. Neither is optional.
- Platform administration cannot accidentally read patient records, because the control-plane credentials cannot reach hospital databases.

Negative:

- Two connection pools, two migration targets, two backup policies.
- Cross-plane reads (for example, a patient record needs a clinician's name) require an explicit call, or a deliberate denormalised copy of the display name.
- Development setup is heavier: the Compose stack must run both.

## Alternatives considered

- **Single schema with `organisation_id` on every table.** Simpler, but leaves the tenant filter optional everywhere and makes "is this table tenant-scoped?" a question for reviewers rather than a fact of the schema. Rejected.
- **One database per hospital for everything, including users.** Would duplicate identity per hospital and make cross-hospital staff accounts impossible. Rejected.

## Follow-ups

- Define the exact boundary list: which tables belong to which plane, maintained in `docs/architecture/` and checked during review.
- Decide whether control-plane reads are allowed inside a hospital request (currently: yes, for membership only, and never selecting clinical fields).
