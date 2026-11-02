# Unresolved decisions

Decisions that are **not** made. Each entry records why it matters, the plausible options, and the trigger that forces a choice. Nothing here should be read as a decision, and no document in this repository may describe one of these as settled. Resolved entries stay in place with a link to their ADR so the decision history remains visible.

Status values: `open` (no decision), `blocked` (needs an external party, e.g. legal), `deferred` (deliberately postponed with a trigger).

| ID | Decision | Status | Needed by |
| --- | --- | --- | --- |
| U-01 | Repository layout: where the web app lives | resolved (ADR-009) | — |
| U-02 | Runtime: Bun vs Node for the API | resolved (ADR-008) | — |
| U-03 | Hosting and cloud provider | open | Before staging |
| U-04 | Data residency and jurisdiction | blocked (legal) | Before any real PHI |
| U-05 | RPO / RTO and DR topology | open | Before production |
| U-06 | Data retention and deletion policy | blocked (legal/clinical) | Before production |
| U-07 | Authentication provider: build or buy | open | Before multi-hospital onboarding |
| U-08 | Session store: PostgreSQL vs Redis | open | Before horizontal scaling |
| U-09 | Tenancy hierarchy: organisation vs hospital | open | Before second hospital |
| U-10 | Migration tool and rollout across hospital databases | tool resolved (ADR-008); fleet rollout open | First migration |
| U-11 | Vocabulary licensing (SNOMED CT, RxNorm, ICD-10) | blocked (legal/commercial) | Before terminology import |
| U-12 | Audit log storage and tamper-evidence | open | Before clinical data |
| U-13 | Clinical AI provider and processing agreement | blocked (legal) | Before real PHI to a model |
| U-14 | Clinical validation and sign-off process | open | Before any clinical workflow ships |
| U-15 | API versioning and deprecation policy | open | First external consumer |
| U-16 | Billing / licensing model | open | Before onboarding a paying hospital |

## U-01 — Repository layout (resolved by ADR-009)

`apps/web/` is the authoritative web app. `frontend/` did not hold the application and no longer exists; ADR-007, which said the opposite, is superseded. See `docs/architecture/decisions/009-web-app-in-apps-web.md`.

Still open: whether the workspace root becomes a Git repository, given that `apps/web/` holds the only `.git`.

## U-02 — Runtime (resolved by ADR-008)

Bun is the runtime for `apps/api` and `apps/worker`; Next.js and Python keep their own toolchains. A Node fallback for the API would require a new ADR, not a configuration flag. See `docs/architecture/decisions/008-runtime-and-persistence.md`.

Still open: whether the worker needs a Node-only dependency; that is a per-dependency check, not a runtime reversal.

## U-03 — Hosting

No provider has been selected, so the Terraform in `infrastructure/AGENTS.md` describes a shape, not a target. The choice constrains managed PostgreSQL, secret management, object storage, KMS and regional availability.

## U-04 — Data residency

Which countries may hold PHI, whether data must stay in a single region, and which transfer mechanisms apply. This is legal advice, not an engineering preference, and it must be settled before the first real patient record exists.

## U-05 — Recovery objectives

No RPO or RTO has been agreed. Until one is, backups exist (when built) but "recoverable" is unproven. `infrastructure/AGENTS.md` deliberately refuses to claim a target.

## U-06 — Retention

How long clinical records, audit logs, documents and AI prompts are kept, and what deletion means in a clinical context (legal hold, minimum retention periods). Wrong answers here are compliance incidents.

## U-07 — Authentication

Build the identity layer in-house (sessions, MFA, invitations, password reset) or use a managed identity provider. Build gives control over clinical-session rules; buy reduces security surface and delivery time. Not decided.

## U-08 — Session store

PostgreSQL keeps the dependency count low but adds write load to the primary; Redis is faster and adds another stateful service. Depends on U-02 and U-03.

## U-09 — Tenancy hierarchy

Is a "hospital" a single site, or does a hospital belong to an organisation with multiple sites sharing staff and a local formulary? The schema stores `hospital_id` today; an organisation layer above it has not been designed.

## U-10 — Migrations (tool resolved by ADR-008; rollout open)

`node-pg-migrate` applying SQL files, one directory per plane. Open: how migrations are applied to every hospital database, how a partially migrated fleet is recovered, and how drift is detected.

## U-11 — Terminology licensing

SNOMED CT requires an affiliate licence and has country-specific release rules; RxNorm is US-centric; ICD-10 varies by country. Which vocabularies ship, and under what licence, is unresolved and blocks the import pipeline design.

## U-12 — Audit

Where audit records live (same database, separate append-only store, external sink), how tamper-evidence is achieved, who can query them, and how long they are retained. Audit is mandatory for clinical actions; the storage decision is open.

## U-13 — Clinical AI

No provider, no agreement, no evaluation harness. Until decided, only synthetic data may reach a model (see ADR-006).

## U-14 — Clinical validation

Who signs off a workflow as clinically acceptable, what the test cases are, and what evidence is kept. Engineering cannot self-certify clinical correctness.

## U-15 — API versioning

Path versioning (`/v1`), header versioning, or additive-only evolution. Affects the frontend, integrations and generated clients.

## U-16 — Billing

Whether Almonac charges per hospital, per bed, per clinician, or per module — and whether the platform is a data processor for each hospital. Shapes the control-plane schema.

## How to resolve one

1. Propose an ADR in `docs/architecture/decisions/` with context, options and consequences.
2. Get the named decider (and legal, where marked) to accept it.
3. Update this table: status becomes `resolved`, with a link to the ADR.
4. Remove the entry from the list only when the ADR exists.
