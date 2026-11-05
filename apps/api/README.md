# Almonac API

Elysia 2 service on Bun. It owns the Control, Hospital and Terminology domains.
The control database foundation is implemented: configuration validation, a
bounded PostgreSQL pool, readiness checks, SQL migrations for the identity,
control and audit schemas, and a least-privilege runtime role. The schema covers
issuer-scoped identities, OIDC session metadata, invitations, organisation and
hospital tenancy, scoped roles and templates, membership history, break-glass
review and a catalogued append-only audit log.

OpenID Connect authentication is implemented: login attempts with PKCE and
nonce, the callback exchange, ID token verification, opaque server-side
sessions, bearer authentication, session access read and logout. Step-up
re-authentication rotates the session token in place. The API owns the flow and
holds the client secret; the web app relays the authorization code and state.

Break-glass access is implemented at `/v1/break-glass`: a permitted clinician
can request a time-boxed, read-only grant for one hospital. An approver can
reserve access for another person, or a clinician can activate an emergency
grant after a step-up. Grants last at most four hours, are reviewed after the
window closes, and every transition is audited.

The admin plane is implemented at `/v1/admin`: organisation provisioning through
the Zitadel management API, hospital and domain management, staff invitations
and acceptance, membership and role changes, and a paginated audit read.
Invitations bind to the signed-in subject. An existing user accepts an
invitation explicitly; a new user accepts it through the initialization login.
Tenant resolution and permission guards on clinical domain routes, hospital
databases and domain features are not implemented.

## Run

Requires Bun (developed on 1.4.2) and PostgreSQL 17 for the control database.

```bash
bun install
cp .env.example .env    # set DATABASE_URL, TEST_DATABASE_URL and the auth values
bun run db:migrate
bun run dev             # http://localhost:3001, watch mode
bun run start           # no watch
```

The local stack in `infrastructure/local/` provides a control database on
`127.0.0.1:5433`. `PORT` defaults to `3001`.

Authentication needs the Zitadel issuer, client ID, client secret, redirect URI
and post-logout URI. `ZITADEL_REDIRECT_URI` points at the web callback
(`http://localhost:3000/api/auth/callback` locally), not at this API.
`SEALING_KEY` is 32 random bytes as unpadded base64url (43 characters) and
`SEALING_KEY_VERSION` identifies it. The admin plane also needs
`ZITADEL_SERVICE_USER_ID`, `ZITADEL_SERVICE_USER_KEY_ID` and
`ZITADEL_SERVICE_USER_PRIVATE_KEY` for the management API, plus `SMTP_URL`,
`SMTP_USER`/`SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_FROM_NAME` and
`WEB_PUBLIC_ORIGIN` for verification and invitation email. Production requires
HTTPS, SMTP credentials, a non-loopback relay and STARTTLS on an `smtp` URL. The API exits at startup when
a value is missing or malformed and prints only the variable name.

## Check

```bash
bun run test              # unit tests; no database required
bun run test:integration  # requires TEST_DATABASE_URL
bun run test:all
bun run typecheck
bun run lint
```

The integration test migrates its database down and up, then leaves it empty.
Use a dedicated database. Never point `TEST_DATABASE_URL` at development or
production data.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe: `{ "status": "ok" }` |
| GET | `/health/ready` | Readiness probe; 503 unless the schema version and runtime privileges are correct |
| POST | `/v1/auth/register` | Start a sign-up: stores a pending registration and emails a verification link |
| POST | `/v1/auth/verify-email` | Consume the verification token and create the Zitadel user |
| POST | `/v1/auth/password-login` | Sign in with an email and password: returns a callback URL |
| POST | `/v1/auth/step-up` | Re-authenticate the current session with a password; requires a bearer session token |
| POST | `/v1/auth/invitation-registration` | Claim an invitation: creates a verified account and returns a callback URL |
| POST | `/v1/auth/callback` | Complete a login or step-up: consumes the attempt, exchanges the code and returns a session token once; `expiresAt` is the absolute expiry |
| GET | `/v1/auth/session` | Current user, active memberships and permissions; requires a bearer session token |
| POST | `/v1/auth/logout` | Revoke the current session and return an optional Zitadel end-session URL; idempotent |
| POST/GET | `/v1/break-glass/grants` | Request emergency access or reserve it for another person; list grants |
| POST | `/v1/break-glass/grants/:grantId/activate` | Activate a reserved grant as its subject |
| POST | `/v1/break-glass/grants/:grantId/revoke` | Close a grant; the subject or an approver may revoke |
| POST | `/v1/break-glass/grants/:grantId/review` | Record an independent review after the access window |
| POST/GET | `/v1/admin/organisations` | Create a provisioned organisation or list the caller's organisations |
| GET | `/v1/admin/organisations/:organisationId` | Read one organisation |
| GET/POST | `/v1/admin/organisations/:organisationId/hospitals` | List or create hospitals |
| GET/POST | `/v1/admin/hospitals/:hospitalId/domains` | List or add a hospital domain |
| POST | `/v1/admin/hospitals/:hospitalId/domains/:domainId/verify` | Verify a domain with its one-time token |
| POST | `/v1/admin/hospitals/:hospitalId/domains/:domainId/primary` | Make a verified domain primary and activate the hospital |
| GET | `/v1/admin/organisations/:organisationId/memberships` | List staff memberships |
| GET | `/v1/admin/organisations/:organisationId/roles` | List instantiated roles |
| POST | `/v1/admin/memberships/:membershipId/suspend` / `revoke` | Suspend or revoke a membership |
| POST/DELETE | `/v1/admin/memberships/:membershipId/roles` | Assign or revoke a membership role |
| GET/POST | `/v1/admin/organisations/:organisationId/invitations` | List or create invitations |
| POST/DELETE | `/v1/admin/invitations/:invitationId/resend` / delete | Resend or revoke a pending invitation |
| POST | `/v1/admin/invitations/accept` | Accept an invitation for the signed-in subject |
| POST | `/v1/onboarding/organisation` | Create the signed-in user's first organisation and become its org admin |
| GET | `/v1/admin/organisations/:organisationId/audit` | Paginated organisation or hospital audit read |
| GET | `/openapi` | Scalar API reference |
| GET | `/openapi/json` | OpenAPI 3.1 document |

The `/v1` prefix follows ADR-012. The root path and versioning policy remain
undecided (`docs/architecture/unresolved-decisions.md`, U-15).

Credentials belong to Zitadel, but the product uses first-party screens
(ADR-016). The browser posts a password to the web BFF, which forwards it to
this API over the private hop. The API calls Zitadel and never stores a
plaintext password.

Sign-up is two steps. `POST /v1/auth/register` stores a pending registration
with a bcrypt hash and a token hash, then emails a verification link.
`POST /v1/auth/verify-email` consumes the row and creates the Zitadel user
with a verified address, so the account can complete OIDC immediately. The API
creates no identity before the address is verified. A password login returns a
callback URL that the browser follows through the existing web callback route.

The API never reads cookies: the web app sends
`Authorization: Bearer <session token>`. A session token is returned only by
the callback response and is stored as a hash in the control database. An
account with MFA enabled returns `MFA_REQUIRED` (403) because challenge
screens are not implemented.

The idle timeout is 15 minutes and the absolute lifetime is 8 hours. The
cookie uses the absolute expiry. A step-up keeps the same absolute expiry and
rotates the token, so the previous token stops working immediately.

The unauthenticated auth routes are rate limited in the control database, so
every API replica shares one budget. A client address gets 30 login attempts,
30 callbacks and 10 step-ups per minute. Register allows 5, email verification
10 and password login 10 attempts per minute. A rejected call returns 429
`RATE_LIMITED` with `Retry-After`. `identity.rate_limit` stores a SHA-256
digest of the route and address, never the address itself; an operations job
must delete rows whose window has passed. The API limits the address Bun
reports, so a proxy in front of it must preserve the client address.

Operational counters are one JSON object per line on stdout:
`auth.login_succeeded`, `auth.login_failed` (with a bounded `reason`),
`auth.id_token_rejected`, `auth.session_revoked`, `auth.rate_limited`
and `admin.provisioning_lag`. Only fixed attribute names and bounded
values are admitted; an email address, token, IP address or free text is
dropped before the line is written. The deployment forwards stdout to its
log pipeline and counts those lines. Error logs never include the thrown
message, request body, token or identity: they carry a request ID, an error
code and a sanitised error name.

Break-glass requires a recent session with at least two authentication factors
(`aal` 2) and an authentication time within five minutes. The ID-token verifier
maps Zitadel's `hwk`, `swk`, `webauthn`, `passkey`, `mfa`, `otp` and `pin` AMR
values to AAL2; it does not infer AAL3, so the API must not claim NIST AAL3.
The timeout and factor policy are enforced on every break-glass transition.
A clinical route still has to consume the grant; the grant alone is not an
authorisation decision. `GET /v1/auth/session` is informational; it
is not the access check for a protected route. Logout is idempotent: a second
call does not add another audit record, and an expired session still returns
the Zitadel end-session URL.

Every failure uses one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found.", "requestId": "..." } }
```

`requestId` also appears in the `x-request-id` response header.

## Migrations

Migrations are plain SQL files in `migrations/`, applied by
`node-pg-migrate` in filename order. Applied files are recorded in
`public.pgmigrations`. Do not edit a migration after it has been applied in a
shared environment; add a new one.

```bash
bun run db:migrate       # apply pending migrations
bun run db:migrate:down  # roll back one migration
```

The scripts load `apps/api/.env`. In deployment, run the CLI with
`DATABASE_URL` supplied by the environment.

Migrations own the tables and run as the migration role. The API must not use
that role. Migration `001_runtime_role` creates the `almonac_app` role, and the
pool sets `role=almonac_app` on every connection. The runtime role can read and
write identity and control data, but it cannot hard-delete identity, tenancy,
assignment-history or break-glass records, change a session's identity or
absolute expiry, or undo a revocation. It can only select from and insert into
`audit.event`, and it may insert but not change a break-glass review. It
cannot change the schema version, the role catalogue, template versions, the
audit event catalogue, platform assignments or create audit partitions. It
may insert into and update rate-limit counters but not delete them.
Privileges are granted per object; the migrations set no default table privileges
and revoke the default function grant from `PUBLIC` globally, so a new function
is executable only by its owner until a migration grants the runtime role
explicitly.

Readiness fails when the connection is not `almonac_app`, the schema version is
not current, or audit `INSERT` is denied or `UPDATE`, `DELETE` or `TRUNCATE`
is allowed. A production login role is `LOGIN NOINHERIT`, is a member of
`almonac_app` only, and is never the table owner. `RESET ROLE` does not clear a
role set at connection start; `SET ROLE NONE` returns to the login role, which
has no table rights.

## Web integration

The Next.js app imports `App` from `src/app.ts` and calls the API through Eden
Treaty in `apps/web/src/lib/api/client.ts`. It reaches the API server-side only,
via `API_URL` (default `http://localhost:3001`), and exposes `GET /api/health`
as a proxy. Do not call this API from the browser.

## Layout

```text
migrations/          SQL migrations for identity, control and audit
src/
├── app.ts           composition root (exports App for Eden)
├── access/          effective permission checks
├── admin/           provisioning, invitations, admin services and routes
├── auth/            OIDC flow, sessions, bearer guard, auth routes
├── config.ts        startup configuration validation
├── index.ts         opens the port and owns the pool lifecycle
├── audit/           append-only event writer
├── break-glass/     time-boxed emergency access service and routes
├── db/              control pool, migration runner, row parsing
├── health/          liveness and readiness features
├── identity/        user, session, access and pending-registration repositories
├── onboarding/      first-organisation service and routes
├── plugins/         security headers, errors, OpenAPI
└── shared/          error envelope, AppError, tokens, sealing
test/
├── unit/            no database
└── integration/     real PostgreSQL
```

Domain features follow the four-file layout in `AGENTS.md`. Read that file
before adding a route.
