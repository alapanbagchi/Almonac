# Unresolved decisions

These decisions are **not** made. Each entry records why it matters, the possible options and the event that forces a choice. Do not read an entry as a decision. No document in this repository may describe an entry as settled. Resolved entries stay in place with a link to their ADR. This keeps the decision history visible.

Status values: `open` (no decision), `blocked` (waiting for an external party, for example legal) and `deferred` (deliberately postponed with a trigger).

| ID | Decision | Status | Needed by |
| --- | --- | --- | --- |
| U-01 | Repository layout: where the web app lives | resolved (ADR-009) | - |
| U-02 | Runtime: Bun or Node for the API | resolved (ADR-008) | - |
| U-03 | Hosting and cloud provider | open | Before staging |
| U-04 | Data residency and jurisdiction | blocked (legal) | Before any real PHI |
| U-05 | RPO and RTO and disaster recovery topology | open | Before production |
| U-06 | Data retention and deletion policy | blocked (legal and clinical) | Before production |
| U-07 | Authentication provider: build or buy | resolved (ADR-010) | - |
| U-08 | Session store: PostgreSQL or Redis | resolved (ADR-012) | - |
| U-09 | Tenancy hierarchy: organisation or hospital | resolved (ADR-011) | - |
| U-10 | Migration tool and rollout across hospital databases | tool resolved (ADR-008). Fleet rollout open. | First migration |
| U-11 | Vocabulary licensing (SNOMED CT, RxNorm, ICD-10) | blocked (legal and commercial) | Before terminology import |
| U-12 | Audit log storage and tamper evidence | open (control table implemented, ADR-014; retention and external tamper evidence open) | Before clinical data |
| U-13 | Clinical AI provider and processing agreement | blocked (legal) | Before real PHI goes to a model |
| U-14 | Clinical validation and sign-off process | open | Before any clinical workflow ships |
| U-15 | API versioning and deprecation policy | open | First external consumer |
| U-16 | Billing and licensing model | open | Before onboarding a paying hospital |

## U-01 - Repository layout (resolved by ADR-009)

`apps/web/` is the authoritative web app. `frontend/` did not contain the application and no longer exists. ADR-007 said the opposite and is superseded. See `docs/architecture/decisions/009-web-app-in-apps-web.md`.

The workspace root is the Git repository. `apps/web/` has no separate `.git`. The ADR-009 text about a nested repository is out of date. Correct it when that ADR is next changed.

## U-02 - Runtime (resolved by ADR-008)

Bun is the runtime for `apps/api` and `apps/worker`. Next.js and Python keep their own toolchains. A Node fallback for the API needs a new ADR, not a configuration flag. See `docs/architecture/decisions/008-runtime-and-persistence.md`.

Still open: whether the worker needs a Node-only dependency. Check each dependency. This is not a runtime reversal.

## U-03 - Hosting

No provider has been selected. The Terraform description in `infrastructure/AGENTS.md` describes a shape, not a target. The choice affects managed PostgreSQL, secret management, object storage, KMS and regional availability.

## U-04 - Data residency

This entry covers which countries may hold PHI, whether data must stay in one region and which transfer mechanisms apply. This is legal advice, not an engineering preference. It must be settled before the first real patient record exists.

## U-05 - Recovery objectives

No recovery point objective (RPO) or recovery time objective (RTO) has been agreed. Until one is, backups exist (when built) but recoverability is unproven. `infrastructure/AGENTS.md` does not claim a target.

## U-06 - Retention

This entry covers how long clinical records, audit logs, documents and AI prompts are kept. It also defines what deletion means in a clinical context, including legal hold and minimum retention periods. A wrong answer here is a compliance incident.

## U-07 - Authentication (resolved by ADR-010)

Zitadel, self-hosted, owns credentials, MFA, passkeys, reset and the hosted login. Almonac owns authorisation, memberships and the API session. Production use is gated on legal review of the AGPL-3.0 licence and on the hosting and BAA position. See `docs/architecture/decisions/010-zitadel-identity-provider.md`.

## U-08 - Session store (resolved by ADR-012)

Opaque sessions live in the control PostgreSQL database (`identity.web_session`). Almonac does not add Redis. Touch throttling bounds the write rate, and the session table is indexed by token hash. See `docs/architecture/decisions/012-api-owned-oidc-sessions.md`.

## U-09 - Tenancy hierarchy (resolved by ADR-011)

An organisation owns hospitals. The hospital is the clinical and data boundary. A user has one global identity and can hold memberships at hospitals in any organisation, including cross-organisation locums. Organisation ownership never grants clinical access. See `docs/architecture/decisions/011-organisation-hospital-tenancy.md`.

## U-10 - Migrations (tool resolved by ADR-008. Rollout open.)

`node-pg-migrate` applies SQL files, with one directory for each plane. Open questions: how to apply migrations to every hospital database, how to recover a partly migrated fleet and how to detect drift.

## U-11 - Terminology licensing

SNOMED CT needs an affiliate licence and has country-specific release rules. RxNorm is US-centric. ICD-10 varies by country. Which vocabularies Almonac ships, and under which licence, is unresolved. This blocks the import pipeline design.

## U-12 - Audit

This entry covers where audit records live (the same database, a separate append-only store or an external sink), how to achieve tamper evidence, who can query them and how long to retain them. Audit is mandatory for clinical actions. The storage decision is open.

Starting point: `audit.event` in the control database is append-only (ADR-014). Triggers reject UPDATE, DELETE and TRUNCATE. The runtime role can only select from and insert into the table, and cannot change the event time. The API writes this table, including denials. This is not a final tamper-evidence or retention design. An external sink, hash chaining, partition retention and a retention policy remain open (U-06).

## U-13 - Clinical AI

There is no provider, no agreement and no evaluation harness. Until Almonac decides, only synthetic data may go to a model (see ADR-006).

## U-14 - Clinical validation

This entry covers who signs off a workflow as clinically acceptable, what the test cases are and what evidence Almonac keeps. Engineering cannot self-certify clinical correctness.

## U-15 - API versioning

The options are path versioning (`/v1`), header versioning or additive-only evolution. The choice affects the frontend, integrations and generated clients.

The authentication and administration routes use `/v1` (ADR-012). That is a convention, not a deprecation policy. A change to a request or response shape still has no agreed process.

## U-16 - Billing

This entry covers whether Almonac charges per hospital, per bed, per clinician or per module. It also covers whether the platform is a data processor for each hospital. The answer shapes the control-plane schema.

## How to resolve one

1. Propose an ADR in `docs/architecture/decisions/` with context, options and consequences.
2. Get the named decider, and legal where marked, to accept it.
3. Update the table. Set the status to `resolved` and add the ADR link.
4. Keep the section in place. Do not delete the decision history.
