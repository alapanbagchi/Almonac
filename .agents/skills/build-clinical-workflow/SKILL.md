---
name: build-clinical-workflow
description: Use when building a clinical workflow end to end across Almonac — frontend screens, API contracts, Elysia services, PostgreSQL persistence, authorisation and audit. Suitable for new clinical capabilities such as ordering, documenting, scheduling or reviewing results. Enforces workflow discovery before code and blocks invented clinical rules.
---

# Build a clinical workflow

This skill is a gate as much as a procedure. A clinical workflow is not "a CRUD screen": it encodes a decision that affects patient care, and it must be traced from the user's intent to the persisted record.

Do not start with the database schema. Do not start with the API. Start with the workflow.

Read root `AGENTS.md`, `apps/web/AGENTS.md`, `apps/api/AGENTS.md` and `database/AGENTS.md`.

## Phase A — Workflow discovery

Write a short specification (one page) answering:

1. **User** — which role performs this (nurse, physician, pharmacist, registrar, admin)? Which roles observe it?
2. **Clinical purpose** — what decision or action does this support? What goes wrong if it is unavailable?
3. **Trigger** — what starts it (arrival, order, result, schedule, manual action)?
4. **Required information** — the minimum data needed at each step. Mark each field as required, optional, or derived.
5. **Permitted actions** — create, edit, sign, cancel, amend, acknowledge. State which are irreversible.
6. **Expected outcome** — what record exists afterwards, and what downstream process reads it.
7. **Error scenarios** — missing data, conflicting order, duplicate, stale record, offline, concurrent edit.

If the clinical rule is ambiguous (dose limits, escalation, who may sign), **stop and escalate**. Do not pick a rule because it is convenient. Record the question in the PR and, if it is architectural, propose an ADR.

## Phase B — Domain design

- **Entities** and relationships: patient, encounter, order, administration, note, result. Name them in domain language.
- **Lifecycle**: draft → signed → amended/cancelled. Draw the allowed transitions; every other transition must be rejected server-side.
- **Ownership**: which domain (control / hospital / terminology) and which hospital database.
- **Clinical invariants**: state them as testable rules ("an administration cannot exceed the ordered dose without an override record", "a signed note cannot be edited, only amended").
- **Terminology dependencies**: which codes are needed (drug concept, diagnosis, observation), and where the source and version are stored.
- **Audit obligations**: which actions must be auditable and what must be captured.

Do not model terminology codes as free text. Do not store a code without its system and version.

## Phase C — Frontend

- Design the screen around the workflow, not around the tables. Identify the single primary action.
- Components: page composes; feature components live beside the route; design-system primitives stay generic.
- Forms use TanStack Form + Zod and `ValidatedField`. One schema per form; share rules with the API when it exists.
- States to design explicitly: loading, empty, error, permission-denied, stale/concurrent edit, success.
- Clinical input must be draft-safe: warn before discarding, never silently lose a half-written note.
- Accessibility: labels, keyboard order, focus after submit, error announcement.
- Use synthetic patients and clearly fake data. Never use real PHI in development.

If the API does not exist yet, build the screen against a typed fixture with the exact shape of the planned contract, and label it as a mock in the PR.

## Phase D — API contracts

Before implementing, write the contract:

| Method | Path | Permission | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /encounters/:id/notes | `note.create` | `noteCreateBody` | `noteResponse` | 400, 403, 404, 409, 422 |

- Schemas in `model.ts` with Elysia `t`; explicit response shape.
- Pagination for lists; no unbounded result sets.
- Errors use the shared envelope and codes (`VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RULE_VIOLATION`).
- State the authorisation requirement per endpoint, including who may sign or amend.
- Version the contract when it changes incompatibly; do not silently change a field's meaning.

## Phase E — Backend and database

Implement in this order:

1. Migration: tables, constraints, indexes, tenant key. Constraints encode invariants the database can hold.
2. Repository: tenant-scoped queries, explicit column mapping.
3. Service: invariants, lifecycle transitions, typed errors, transaction boundary.
4. Route: schemas, guard, one-line handler, OpenAPI detail.
5. Audit: record the clinical action in the same unit of work where possible.
6. Composition: mount the feature in its domain.

Multi-step writes (order + audit, note + version) run in one transaction. Do not publish an event before commit.

## Phase F — Security

Check and record:

- Authentication on every route.
- Hospital membership verified server-side; the hospital ID is only a selector.
- Permission checked for each operation, including read of a specific record.
- Cross-hospital access returns 404/403 and never data.
- Minimum data returned — no full patient record when a summary is enough.
- No PHI in logs, URLs, analytics, error messages or queue payloads.
- Sensitive actions audited with actor, target, timestamp and outcome.

Run the `tenant-isolation-review` skill if the workflow introduces a new data path.

## Phase G — Verification

A workflow is not complete because the screen renders and the endpoint returns 200.

- End-to-end: perform the workflow as the intended role and confirm the record persisted with the right author, time and status.
- Permission matrix: each role, allowed and denied.
- Invalid transitions: signed → edit rejected; cancelled → administer rejected.
- Concurrency: two users editing the same note; stale update rejected.
- Isolation: hospital A cannot reach hospital B by guessing IDs.
- Failure: API down, database down, timeout — the UI shows an actionable error and does not lose input.
- Audit: the action appears with the correct actor and target.

Report exactly what you ran and what you could not (for example, no staging database). Do not claim clinical correctness — a clinician must validate the workflow.

## Anti-patterns

- Building the schema first and inventing the workflow to fit it.
- Treating a status field as free text with no transition rules.
- Storing a terminology code without system or version.
- Editing a signed note in place.
- Adding optimistic UI to an audited clinical action.
- Assuming organisation membership grants hospital access.
- Hiding a permission failure as an empty list.
