# ADR-014: Control database schema and privileges

- **Status:** Accepted
- **Date:** 2026-11-03
- **Revised:** 2026-11-04
- **Deciders:** Backend, Security
- **Related:** ADR-002, ADR-004, ADR-008, ADR-010, ADR-011, ADR-012, U-09, U-12

## Context

Almonac stores identity, tenancy, authorisation and audit records in one control database. This database is not a clinical database. It must never hold patient records (ADR-001 and ADR-011). It is still sensitive: a read of the identity tables exposes staff emails, session material and organisation structure. A write can grant access to a hospital.

The first schema draft had these defects:

- The application used the migration role. That role owned the audit table and could disable its append-only triggers.
- A role could change scope after grants existed. The database did not recheck the grants.
- A nullable organisation ID meant both "system role" and "global custom role".
- Two break-glass models could disagree.
- An active membership could have a future start or a past end.
- An expired invitation blocked a new invitation for the same email and scope.
- A subject was unique without its issuer, so two identity providers could collide.
- A role template could change under existing roles. Membership roles were mutable links without history. A membership could be revoked while a role was being added.
- Break-glass required a prior approver, so emergency access had no safe path. Audit metadata accepted free-form keys.
- Readiness checked only that the database answered. It did not check the schema version or the runtime privileges.

This ADR defines the replacement baseline. The integration tests apply it to PostgreSQL 17.10.

## Decision

**Use one control database with three schemas, a separate migration role and runtime role, database-enforced scope and time constraints, and an append-only partitioned audit schema.**

### Schemas

| Schema | Contents | Clinical data |
| --- | --- | --- |
| `identity` | Users, login attempts, web sessions, invitations | Never |
| `control` | Organisations, hospitals, domains, permissions, roles, memberships, break-glass grants, schema metadata | Never |
| `audit` | Security and access events | Never |

The API connects only to the control database. Hospital databases hold clinical data and have no identity or authorisation tables (ADR-002 and ADR-011).

### Migration and runtime roles

- Migrations run as a database owner role. This role creates and alters objects. It is not used by the API.
- Migration `001_runtime_role` creates or updates the `almonac_app` role. The role is `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS`.
- The API pool sets `role=almonac_app` on every connection. The production login role is `LOGIN NOINHERIT` and is a member of `almonac_app` only. It must not be the migration owner and must not hold direct table rights. `RESET ROLE` does not clear a role set at connection start; `SET ROLE NONE` returns to the login role, which has no schema or table rights. The integration test proves both behaviours.
- The runtime role gets `USAGE` on the three schemas, data manipulation on `identity` and `control`, and only `SELECT` and `INSERT` on `audit.event`. It has no `CREATE`, `ALTER` or `DROP` right.
- `control.schema_metadata` is read-only to the runtime. Migrations write the schema version.
- The runtime role may read the role catalogue, but it cannot change `control.permission`, `control.role`, `control.role_permission`, `control.role_template`, `control.role_template_version`, `control.role_template_permission`, `control.platform_assignment` or `audit.event_type`. These tables are configuration. A compromised API must not be able to grant `platform.manage` to a user or role, rewrite a template version or add an audit event type.
- The runtime role cannot delete `identity.app_user`, `identity.invitation`, `control.organisation`, `control.hospital`, `control.hospital_domain`, `control.membership`, `control.membership_role`, `control.invitation_role`, `control.break_glass_grant` or `control.break_glass_review`. Deletion is an operator action. The API changes status, revocation or retirement fields instead.
- The runtime role may insert a break-glass review but cannot update or delete one. A review is evidence.
- Privileges are granted explicitly. The migrations define no default table or sequence privileges. A global default-privilege statement revokes `EXECUTE` on new functions from `PUBLIC`, and no schema-level default grants it back, so a new function is executable only by its owner until a migration grants the runtime role explicitly.
- `audit.ensure_month_partition(date)` is not executable by the runtime. Partition creation is an operations task.
- Trigger functions are executable by the runtime because they run as the invoker. No function is `SECURITY DEFINER`.
- Readiness checks `current_user = almonac_app`, schema version `2`, audit `INSERT` is allowed, and audit `UPDATE`, `DELETE` and `TRUNCATE` are denied. A database that answers but has the wrong schema or privileges is not ready.

### Identity tables

- `identity.app_user` has one row for each external identity. The pair `(identity_issuer, zitadel_sub)` is unique; the subject is not unique across issuers. `email` is globally unique, uses `citext` and must be lower case. A user has one home organisation. The issuer and subject are immutable. A login must compare both values, not the subject alone.
- `identity.login_attempt` stores a SHA-256 state hash, a nonce hash, an encrypted PKCE verifier, a key version, an internal return path, a purpose and an expiry. The purpose is `login` or `step_up`. A step-up attempt names a user; a login attempt does not. The return path must start with one slash and must not contain a backslash or control character.
- `identity.web_session` stores the identity issuer, an optional OpenID Connect session ID and authentication context class, a SHA-256 session-token hash, optional sealed ID-token hint, authentication methods, authentication time, assurance level and idle and absolute expiry. It has no refresh token. `auth_time` cannot be later than creation. Idle expiry cannot be later than absolute expiry. A revocation time and reason must be set together. The session identity is immutable: ID, user, issuer, OIDC session ID, authentication context, token hash, methods, authentication time, assurance level, creation time and absolute expiry cannot change. Revocation is final, including its reason. Only `last_seen_at` and `idle_expires_at` may change.
- `identity.invitation` stores a SHA-256 token hash, an email, an organisation, an optional hospital, a kind, an optional Zitadel subject, an inviter, a status and an expiry. A new-user invitation has no subject. An existing-user invitation has one. An invitation starts pending; a direct insert in another state is rejected. Accepted, revoked and expired states must agree with their timestamps and actors, and acceptance must happen before expiry. An accepted invitation records the accepting user. Accepted, revoked and expired states are final. The email, organisation, hospital, kind and subject are immutable. A service must lock the invitation, copy its roles, create the membership and set the accepted state last.

### Tenancy

- `control.organisation` is the Almonac organisation. It may link to one Zitadel organisation. The link is immutable after it is set. An active organisation must have a Zitadel organisation ID and a provisioning time.
- `control.hospital` belongs to one organisation. The organisation link is immutable. A hospital slug is unique inside its organisation.
- `control.hospital_domain` stores verified domains. A domain is globally unique. A verified domain is immutable. A primary domain must be verified, not retired, and belong to the same hospital. A primary domain cannot be unverified or retired. Validation and retirement take a per-hospital advisory lock, so they cannot both succeed in a race.
- An active hospital must have a primary domain. A pending hospital may exist before domain verification. Status and domain checks prevent a hospital from becoming active without proof of control.

### Authorisation

- `control.permission` has a scope: `platform`, `organisation` or `hospital`. The key and scope are immutable.
- `control.role` has a scope, a nullable organisation and an `is_system` flag. A system role has no organisation and is always a platform role. A non-system role belongs to an organisation and is an organisation or hospital role.
- `control.role_template` names a baseline organisation or hospital role. `control.role_template_version` holds each immutable version of its name and permissions. Templates are not assignable roles. They let provisioning create a role for one organisation without a global organisation role that any organisation could use. A role may record the template version it came from; the source must match its scope.
- `control.platform_assignment` assigns a platform role to a user. This is separate from membership. A platform role is never a membership role. The runtime role can read platform assignments but cannot create or change them; a reviewed privileged path is a follow-up.
- A role permission cannot have a broader scope than its role. A hospital role cannot hold an organisation or platform permission. An organisation role cannot hold a platform permission.
- `control.membership` is the access record. It has an accepted time and a `tstzrange` validity. The start of the range equals the accepted time. Active and suspended memberships for the same user and hospital cannot overlap. Organisation memberships follow the same rule. This prevents a race that creates two active grants. Suspension, revocation and expiry record their own times and actors. Revoked and expired states are final. Authorisation must also compare the range with the request time; an active row whose range has not started or has ended grants nothing.
- `control.membership_role` is assignment history, not a mutable link. Each assignment has its own validity range, assigning actor and optional revocation actor and reason. A revoked assignment stays in the table. Active assignments for the same membership and role cannot overlap. A role can be assigned again after it is revoked.
- A membership role must match the membership scope. A hospital membership needs a hospital role in the same organisation. An organisation membership needs an organisation role in the same organisation. The database rejects a platform role in either place, rejects a new role on a revoked or expired membership, and rejects a role whose validity is outside the membership validity.
- `control.break_glass_grant` is the only break-glass model. Access is read-only and the reason is mandatory. A pre-approved grant names an approver who is not the subject and has an approval time no later than access starts. An emergency grant has no prior approver; the subject activates it and an independent review follows. Approval does not grant access: a grant must be activated. Only the subject can activate a grant. The validity range must have a fixed start and end and cannot exceed four hours. Active grants for the same user and hospital cannot overlap. The approved scope, validity, approval mode and reason are immutable. Activation is final. Revoked and expired states are final, and a grant cannot expire before its access window closes.
- `control.break_glass_review` records the post-access decision. The reviewer is neither the subject nor the approver, the review happens after the access window closes and cannot be dated in the future, and one reviewer can review a grant once.

### Audit

- `audit.event` is append-only. The migration role owns the table. The runtime role can insert and select only.
- Triggers reject `UPDATE`, `DELETE` and `TRUNCATE`. A separate trigger rejects an `occurred_at` more than one minute from the database clock. The trigger validates the value; it does not change it, because PostgreSQL cannot move a row to another partition during a row trigger.
- The table is partitioned by month on `occurred_at`. The migration creates a default partition and partitions for the current and next month. Operations must create future partitions before the default partition grows. The partition function grants the runtime role select and insert on each new partition; it does not grant update or delete.
- The primary key is `(id, occurred_at)`, and `id` is a `bigint` identity column. The partition key must be part of the primary key.
- `audit.event_type` is the event catalogue. It fixes the event vocabulary, whether an event needs a reason code, and the only metadata keys that the event may carry. The runtime role can read the catalogue but cannot change it. An event type outside the catalogue is rejected.
- Metadata is a JSON object with a logical size limit of 8192 bytes. Every key must be on the event type allowlist. The size limit is not a privacy control; the allowlist is. Callers must not put clinical data in metadata.
- BRIN indexes support time-range scans. B-tree indexes support organisation, hospital, actor and request lookups. `event_type` is not indexed because its cardinality is low.

### Performance and operations

- Indexes cover foreign keys and the composite keys used by foreign keys. Missing indexes on referencing columns make deletes and updates scan the child table.
- `identity.web_session` uses `fillfactor = 90` because the row is updated on each request. `idle_expires_at` is not indexed because it changes on each touch. Cleanup scans `absolute_expires_at`.
- Migrations run in one transaction and set `lock_timeout = '5s'`. A migration that needs `CREATE INDEX CONCURRENTLY` must run outside this runner.
- The runtime role is local to the database. Production grants a login role the right to `SET ROLE almonac_app`; the API never uses the owner role.
- A scheduled job must create future audit partitions and remove expired login attempts, sessions and invitations according to the retention policy.

## Consequences

Positive:

- The database enforces the security model even if a service forgets a check.
- A compromised API credential cannot rewrite or delete audit events.
- Role scope, membership time and break-glass approval cannot drift after the fact.
- Readiness detects a half-migrated database or a connection with the wrong role.
- Partitioned audit storage keeps index size and vacuum cost bounded.

Negative:

- The schema is larger and has more triggers. Changes need migration tests.
- The runtime role and the login role are separate operational objects. A deployment must create the login role as `LOGIN NOINHERIT`, grant it `almonac_app` only, and never grant it owner membership or direct schema rights.
- Custom role changes need a separate operator path until a reviewed privileged function exists.
- Audit partitions need an operations job. A missing job sends rows to the default partition.
- The database rejects some updates that a simpler schema would allow. Repositories must model role and membership changes as new rows, not in-place changes.
- The `audit.event` owner can still disable triggers. Separation of duties and restricted owner access are required; the schema alone cannot stop a superuser.

## Alternatives considered

- **One schema for everything.** Simpler, but it hides the audit boundary and makes least privilege harder. Rejected.
- **Application-only authorisation.** Faster to write, but a service bug becomes an access-control breach. Rejected. The database is the last line of defence.
- **One runtime role that owns the tables.** Common in small systems, but it defeats append-only audit and migration separation. Rejected.
- **A separate audit database.** Stronger isolation, but it adds a second write path and a distributed failure mode before the audit volume needs it. The `audit` schema and separate privileges are the current boundary. Revisit when audit volume or regulation requires a separate store (U-12).
- **Table partitioning by organisation instead of time.** Most queries are time-bounded and retention is time-based. Time partitions are simpler. Rejected for now.
- **A global custom organisation role.** It avoids one role per organisation, but the same role could be assigned in any organisation. Rejected in favour of role templates and per-organisation roles.

## Follow-ups

- Add a reviewed, privileged path for custom organisation roles and platform assignments. The runtime role cannot change role definitions or assign platform roles.
- Add the audit partition job and a test that creates the next month before it is needed.
- Define retention for audit events, login attempts, sessions and invitations, then add the cleanup job (U-06 and U-12).
- Grant the production login role the right to `SET ROLE almonac_app` and verify the grant in staging.
- Add a migration test for the owner role: the owner must not be the API login role.
- Extend the audit metadata allowlist only with reviewed keys. Do not accept free-form values that can contain patient data.
- Add the invitation acceptance service path in P3: lock the invitation, copy its roles, create the membership, then set the accepted state.
- Add a review queue and overdue alert for emergency break-glass grants in P6.
- Confirm template versioning operations in P5: a new version is a new row, and existing roles keep their source version.
- Revisit a separate audit store when the audit volume, retention or regulatory requirement is known.
- Add query-plan tests for the main audit and membership queries after real data volumes exist.
