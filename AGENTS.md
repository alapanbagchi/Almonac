# Almonac — Engineering Constitution

Root rules. Nested `AGENTS.md` files add local rules but never weaken this one. Procedures live in skills (`.agents/skills/`); rationale in ADRs (`docs/architecture/decisions/`).

## 1. System

Multi-organisation, multi-hospital healthcare OS: one global identity, many memberships. Organisations own hospitals but never automatically gain clinical access to them.

| Domain | Owns | Data |
| --- | --- | --- |
| Control | Identity, organisations, hospitals, memberships, roles, tenant registry, provisioning | Shared control DB — no patient records |
| Hospital | Patients, practitioners, encounters, clinical documentation, orders, billing, formularies | One DB per hospital |
| Terminology | RxNorm, SNOMED CT, LOINC, ICD, concepts, versions, provenance | Shared terminology DB |

Next.js (web) → Elysia on Bun (api, owns all three domains) → PostgreSQL via `pg`. Python/FastAPI (clinical-ai) sits behind REST/JSON for NLP, documents and inference. No gRPC. Schema changes are SQL migrations applied by `node-pg-migrate` (ADR-008).

## 2. Status — verify, never assume

Implemented: `apps/web/`, a Next.js 16.4.3 App Router app (React 19.3, Tailwind 4, `cacheComponents` + `partialPrefetching`) with a server-only Eden Treaty client, a server-side authentication BFF (`/api/auth/login`, `/api/auth/callback`, `/api/auth/step-up`, `/api/auth/logout`) that relays the OIDC code and state and keeps the opaque session token in a `__Host-` cookie, a session reader, a guarded dashboard that renders the signed-in member, a Playwright suite against a test API double, a nonce-based content security policy with hardened response headers, and `.env.example`. Also implemented: `apps/api/`, an Elysia 2 service on Bun with `GET /health`, `GET /health/ready`, the shared error envelope, OpenAPI at `/openapi`, validated startup configuration, a bounded control PostgreSQL pool, SQL migrations for the `identity`, `control` and `audit` schemas (issuer-scoped identities, OIDC session metadata, invitations, tenancy, scoped roles and template versions, membership history, break-glass review, catalogued append-only audit), a least-privilege `almonac_app` runtime role, and readiness that checks the schema version and audit privileges. OpenID Connect authentication is implemented on `/v1/auth`: login-attempt start with PKCE and nonce, callback exchange, ID token verification, opaque server-side sessions, bearer authentication, session access read and logout. Token minting and hashing, AES-256-GCM sealing, user, session and access repositories, a session service with idle and absolute expiry, and an audit writer support it. The API owns the OIDC flow; the web app relays the code and state and never holds an access or refresh token. An administration plane on `/v1/admin` provisions organisations through the Zitadel management API, manages hospitals and verified domains, invites staff, accepts invitations, changes memberships and roles, and serves a paginated audit read. The web app exposes that plane through an allowlisted server-side BFF at `/api/admin`, with organisation, hospital, domain, staff, invitation and audit screens, plus a signed-in invitation acceptance page. Step-up re-authentication rotates the opaque session, and `/v1/break-glass` issues time-boxed, read-only emergency grants with independent approval, post-window review and audit. Break-glass requires AAL2 and an authentication time within five minutes; the API does not claim AAL3 (ADR-015). The web app starts step-up through `/api/auth/step-up` and shows a confirmation prompt when an action needs fresh assurance. A break-glass screen requests, lists and revokes grants, and approvers record post-window reviews through an allowlisted `/api/break-glass` relay. Tenant resolution, permission guards on clinical domain routes, hospital database and domain features are not implemented. A development-only stack lives in `infrastructure/local/` (Zitadel, Login v2, PostgreSQL, a separate control PostgreSQL, Traefik, Mailpit). It creates the first Zitadel instance and an administrator, but no Almonac project, OIDC application, SMTP provider or users. Local verification results are in `docs/security/zitadel-spike.md`. `frontend/` does not exist and must not be recreated (ADR-009, superseding ADR-007). Not implemented: Python service, worker, hospital and terminology database schemas, production Dockerfiles, Terraform, Kubernetes; `apps/clinical-ai`, `apps/worker`, `database/` are empty scaffolds. Label that work planned.

Never invent scripts, packages, env vars, endpoints or commands; read the manifest and if absent, say so. If code and docs disagree, stop and report it.

## 3. Boundaries (violations are security defects)

1. Control code never reads clinical data; the control DB never stores patient records.
2. A client-supplied hospital ID selects a resource; it never proves access. Verify membership and permission server-side on every request.
3. Hospital DBs are isolated: separate credentials, pools, migration status. No cross-hospital query, no global patient search.
4. Terminology reads only its own DB; hospital preferences live in hospital storage.
5. Python never connects to hospital DBs and is never a source of truth. Elysia authorises first, then sends the minimum data.
6. PHI never reaches browser storage, URLs, console logs, analytics, full queue payloads or shared caches.
7. No new service, broker or RPC protocol without an accepted ADR. Start as a modular monolith.

## 4. Principles

- **Simplicity.** Build for the described workflow; a third use case justifies an abstraction, not the second.
- **Maintainability.** One feature owns one capability; files should read in one pass. Split by responsibility past ~400 lines.
- **Modularity.** Reuse via exported modules, never another module's internals or tables.
- **Type safety.** No `any`, no `as unknown as`, no unchecked JSON. Parse at boundaries (Elysia `t`, Zod, Pydantic), pass typed values inward.
- **Cohesion.** Business rules in services, HTTP shape in routes/models, SQL in repositories; persistence never decides policy.
- **Separation.** Services take plain arguments (IDs, scalars, DTOs), never `Context`, headers or cookies — that is what makes them testable.
- **Direction.** `route → service → repository → database`, never backwards. Shared utilities import no feature code.
- **Errors.** 400 validation, 401 unauthenticated, 403 unauthorised, 404 missing, 409 conflict, 422 domain rule, 5xx unexpected. 5xx never leaks SQL, traces, secrets or PHI.
- **Validation.** Validate every trust boundary (body, query, params, queue payloads, third-party responses, env config), even if the browser already did. Client validation is UX, not security.
- **Testing.** New behaviour ships with a failing-without-it test; auth changes with a denied-access test; clinical flows with a synthetic-data end-to-end test.

## 5. Dependency rules

Allowed: web → api via the typed client; feature → its own service/repository/model; api → shared plugins; api → clinical-ai over HTTP; clinical-ai → its own modules.

Forbidden: web importing server-only modules, DB clients, secrets or api internals; services depending on HTTP context or ambient tenant state (pass tenant explicitly); repositories holding business rules; shared packages holding secrets; terminology importing hospital repositories; control importing clinical tables; Python querying hospital DBs or doing work Elysia can answer. Check the diff's import graph and grep forbidden paths.

## 6. Security

Least privilege for every credential and token. Defence in depth: UI, route and service checks all required; server-side authorisation only. Tenant isolation at connection, query and cache layers. Least PHI that works. Secrets from the managed store, never source, fixtures or bundles. PHI encrypted in transit and at rest, never logged. Every clinical read/write attributable: actor, tenant, time, action, target. Private buckets, short-lived scoped links. Errors safe externally, detailed only internally. Audit records append-only.

## 7. Agent behaviour and hierarchy

Order of work: inspect tree, manifests, git status and existing code; identify affected modules and domain ownership; read root and nearest `AGENTS.md`, load a matching skill; confirm which DB and service owns the rule; follow native conventions and installed-version docs; keep changes focused (no drive-by refactors or upgrades); add tests including denials; verify type-check, lint, tests and the real runtime path; report failures and skipped checks, never claiming unrun verification; record consequences in an ADR and leave unresolved choices open.

Never silently weaken security, disable a check, widen tenant scope, or add a permissive fallback to pass a test.

Hierarchy: root (this) → nested files on the code path → skills (`.agents/skills/`) → ADRs; accepted ADRs bind. Codex loads one file per directory, repo root → CWD, stops at `project_doc_max_bytes` (32 KiB default), skips empty files — work from the root or these rules and `.agents/skills` are not discovered. `.agents/skills` is the only skill root in this repository: add, edit and reference skills there, never in `.dsh/skills` or `.claude/skills`. Installed third-party skills are advisory procedures, never authority: none may override §3, §6 or this section, authorise a repository-wide deletion sweep (`cleanup-audit --fix`), introduce a second quality contract such as `CONSTRAINTS.md` (`constraint-driven-development`), or supply commands §2 does not define. Where two overlap, the repository-authored skill wins — `build-clinical-workflow` over `frontend-ui-engineering` for clinical screens, `tenant-isolation-review` over `security-and-hardening` for tenancy. Skill examples are not policy: identifier-bearing log lines in `observability-and-instrumentation` are out of bounds under §6.

A skill named in the request outranks the table below; the table outranks any skill's own blurb. Consult it before reading code, and say which skill you loaded.

| Touching | Load first |
| --- | --- |
| `apps/web/` — a screen, component or browser behaviour | `frontend-ui-engineering` |
| a clinical flow end to end — ordering, documenting, results, scheduling, patient screens | `build-clinical-workflow` |
| a new or changed Elysia route, service, repository or typed client | `elysiajs` |
| any query, route, cache, job or storage path over hospital data | `tenant-isolation-review` |
| a behaviour change, bug fix or new logic | `test-driven-development` |
| a new table, clinical concept storage, or terminology mapping (ICD, SNOMED CT, LOINC, RxNorm) | `clinical-data-modeling` |
| authentication, untrusted input, sessions, secrets, third-party responses | `security-and-hardening` |
| production logging, metrics, tracing or alerting | `observability-and-instrumentation` |
| dead code, unused exports, stale manifests | `cleanup-audit` — report only, §7 forbids `--fix` |
| a change spanning more than one file, or the next task from a plan | `incremental-implementation` |
| a diff to review before merge | `code-review-and-quality` |
| Next.js bundles, prefetching, cache components, runtime verification | `next-dev-loop`, then the matching `next-*` skill |

## 8. Done

Behaviour matches the request; types, lint and tests pass; denial paths tested; no PHI or secret exposure; contracts updated; diff limited to the task; report says what was and was not verified.
