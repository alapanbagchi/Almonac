# Almonac Worker — Background Jobs

**Status: not implemented.** `apps/worker` contains no `package.json`, no source and no chosen queue technology. The rules below are the contract any implementation must satisfy; where a decision is genuinely open it is named as open, not guessed.

The worker runs asynchronous work that must not block an HTTP request: exports, notifications, document ingestion, terminology imports, scheduled maintenance, AI batch processing. It is a separate process from the API, but it uses the same domain and database boundaries — it is not a second backend with its own rules.

## 1. Choosing a queue

The queue technology is **undecided**. Prerequisites before choosing:

- Durable delivery and at-least-once semantics (a job survives a process restart).
- Delayed/scheduled jobs and per-queue concurrency limits.
- A dead-letter destination you can inspect and replay.
- PostgreSQL-backed or a managed broker consistent with the deployment decision.

Do not add a broker "because it scales" before the deployment target is known. Do not implement a bespoke in-memory queue or a `setInterval` poller as production infrastructure.

## 2. Job structure

```text
apps/worker/src/
├── index.ts               bootstrap: config, pool, consumer registration
├── queues.ts              queue names, payload schemas, retry policy per queue
├── handlers/<job>.ts      one handler per job type
├── runtime/               dispatch, retries, DLQ, tenant resolution, logging
└── shared/                reused domain clients (never a second copy of API rules)
```

Each job declares:

| Field | Requirement |
| --- | --- |
| `type` | Stable string, namespaced (`hospital.export.patients`), never renamed silently |
| `version` | Integer; bump when the payload shape changes, handle old and new during rollout |
| `payload` | Validated by a schema at enqueue **and** dequeue; no unvalidated JSON |
| `tenant` | Hospital ID plus the enqueuing actor — a reference, not a credential |
| `idempotencyKey` | Stable per logical operation; required for anything that mutates or sends |
| `attempt`, `maxAttempts`, `createdAt` | Managed by the runtime, not the handler |

A handler signature is `(job, ctx) => Promise<Result>` where `ctx` carries a resolved tenant, a scoped database handle, a logger and an abort signal. Handlers return a small result; they do not return patient data that then gets persisted into the queue record.

## 3. Tenant context

Every hospital-specific job carries a trusted tenant reference, but **a queue payload is not authorisation**. A malicious or buggy producer can enqueue any hospital ID.

Before touching hospital data the handler must:

1. Load the hospital from the control registry.
2. Confirm it exists and is active (not suspended, not deprovisioned).
3. For actor-scoped jobs, confirm the actor still has an active membership and the required permission at execution time — not just at enqueue time.
4. Resolve the hospital's own pool and credentials through the same tenant resolver the API uses.

Revoked access must stop a queued job. A job enqueued yesterday by a user removed today must fail closed, with an audit event, not "finish what it started".

Never process a job with a missing, unknown or ambiguous tenant. Never fall back to a default hospital. Never let a payload select a database name or connection string.

## 4. Database access

- Same rules as `apps/api`: one pool per hospital, credentials scoped to that database, no cross-tenant joins, no privileged superuser connection.
- A worker process may hold pools for many hospitals; bound the total and per-hospital connections, and evict idle pools. Concurrency limits must account for pool size, not just CPU.
- One transaction per unit of work. Do not hold a transaction open across an HTTP call, a model call or a queue publish.
- Long jobs process in batches with checkpoints, so a crash resumes rather than restarts from zero.
- Migrations are not run by the worker at boot. Provisioning/ops owns schema changes; a worker starting against an older schema must fail clearly.

## 5. Idempotency and retries

- Assume at-least-once delivery: every handler must be safe to run twice. Use the idempotency key plus a unique constraint or a processed-jobs record to make the effect once-only.
- Side effects that cannot be made idempotent (sending an email, calling a paid model) are recorded before or with the effect, and re-checked on retry.
- Retries use bounded exponential backoff with jitter. Classify errors:
  - **Retryable:** timeouts, connection resets, 429/503, lock contention.
  - **Permanent:** validation failure, unknown tenant, forbidden, missing required record. Do not retry these; route to the dead-letter queue with a reason.
- Never retry a write blindly after an ambiguous failure — check whether it committed first.
- On exhaustion, move the job to the dead-letter queue with the error code, attempt count and correlation ID. Never drop it silently, and never loop forever.

## 6. Timeouts and failure recovery

- Every job has a wall-clock timeout and a heartbeat if the queue supports visibility timeouts. A stuck job must be reclaimed, not block a queue forever.
- Abort signals propagate to database queries and HTTP calls; clean up partial artifacts in `finally`.
- On shutdown, stop accepting new jobs, finish or safely release in-flight work, close pools, then exit. Do not kill a process mid-transaction without a defined recovery path.
- Partial outputs (export files, generated documents) are written to a temporary private location and published atomically on success; orphans are cleaned by a scheduled job.
- Repeated crashes on the same job type must alert, not just retry.

## 7. PHI minimisation

- Queue payloads carry identifiers and parameters, not full patient records. A handler loads what it needs at execution time through the tenant-scoped repository.
- Logs contain job type, tenant ID, job ID, attempt, duration and outcome — never patient names, identifiers, note text or document contents.
- Dead-letter records store the error and a reference to the input, not a copy of PHI. If replay needs the input, store an encrypted reference with a TTL, not raw content.
- Exports and generated files live in private storage, are encrypted at rest, are served only through short-lived signed URLs, and expire on a defined schedule.
- Notifications never include clinical detail beyond what the recipient is authorised to see; a push or email body is not a secure channel.
- Error trackers and metrics receive the same treatment: no PHI in labels, no attachments with patient data.

## 8. Audit

- Record an audit event for jobs that create, change, export or disclose clinical data: actor (or "system" with the originating request ID), hospital, job type, target identifiers, outcome, timestamp.
- Audit writes are part of the unit of work where possible; a job that mutates data and fails to record the audit is not successful.
- Audit records are append-only from the worker's perspective; no updates or deletes.
- Where the audit store lives is an unresolved architectural decision — do not build a second audit system in the worker before it is decided.

## 9. Testing

- Handler unit tests with a fake repository and fake clock: success, retryable failure, permanent failure, duplicate delivery.
- Idempotency test: run the same job twice, assert one effect.
- Tenant tests: unknown hospital, suspended hospital, revoked membership, mismatched hospital ID in the payload — each must fail closed with no data access.
- Integration test against real PostgreSQL with migrations applied, including the unique constraints that back idempotency.
- Timeout/abort test: a slow dependency does not hang the worker.
- Failure-recovery test: kill mid-job, restart, assert no duplicate effect and no partial artifact.

## 10. Before you finish

Types, lint and tests pass. No PHI in payloads, logs or fixtures. Every new job declares tenant, idempotency and retry policy explicitly. The diff does not add a second copy of business rules that belong in `apps/api`. Report anything you could not verify, especially behaviour under a real broker.
