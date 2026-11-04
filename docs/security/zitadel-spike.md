# Zitadel local verification record

- **Date:** 2026-11-04
- **Status:** Passed for the local stack, including the product API login, session and logout path. Production deployment is still gated by ADR-013.
- **Scope:** Prove that the self-hosted Zitadel stack can issue the authorization code, ID token and claims that the API design in ADR-012 depends on.
- **Environment:** Docker Compose, Zitadel v4.20.1, Zitadel login v4.20.1, PostgreSQL 17.10, Traefik v3.7.7, Mailpit v1.33.0 and Node 26.11.1.
- **Mail note:** Mailpit was a spike-only mail catcher. The current local stack removed it; both senders use a real relay. See `docs/operations/runbooks/email-delivery.md`.

The stack and all users were synthetic. No patient data, production credentials or real email addresses were used.

The local verification scripts are not part of the product repository. This record shows what the product must reproduce. It is not a test procedure.

## What was verified

| Check | Result |
| --- | --- |
| Compose stack starts and becomes healthy | Passed |
| First instance and IAM_OWNER user are created | Passed |
| Management API creates the project, role, OIDC app and users | Passed |
| Authorization Code flow with Proof Key for Code Exchange (PKCE, S256) | Passed |
| A deactivated user is denied at login | Passed |
| Callback state and nonce validation | Passed |
| Code exchange with the confidential client secret | Passed |
| Issuer, audience and authorised-party validation | Passed |
| ID token contains email, name and role claims | Passed after `idTokenUserinfoAssertion` was enabled |
| SMTP provider is created and activated through the Admin API | Passed |
| Initialization email is delivered to Mailpit | Passed |
| Initialization link loads the Activate User page | Passed |
| Product API verifies a live ID token against the Zitadel JWKS | Passed |
| Product API creates an opaque session and reads it with a bearer token | Passed |
| Logout revokes the local session and ends the Zitadel session | Passed |
| A replayed callback is rejected | Passed |
| Zitadel Helm chart 10.4.0 lints and renders | Passed. No Kubernetes cluster was available. |

## Findings

### Login v2 is mandatory

Zitadel 4.x requires Login v2 by default. The login UI runs in a separate container and is routed under `/ui/v2/login`. The API default login and logout URLs point to that path. A deployment with only the core image redirects to a login URL that does not exist.

### The ID token omits email and profile by default

The first run requested `openid profile email`. The ID token contained only protocol claims: `iss`, `sub`, `aud`, `azp`, `amr`, `auth_time`, `exp`, `iat`, `sid` and the project role claims. It had no `email`, `email_verified`, `name` or `preferred_username`.

Zitadel copies userinfo claims into the ID token only when the OIDC application has `idTokenUserinfoAssertion` enabled. After Almonac enabled it, the token contained:

```json
{
  "email": "<user email>",
  "email_verified": true,
  "name": "<display name>",
  "preferred_username": "<user email>"
}
```

Without this setting, the API must call the userinfo endpoint at login to learn the user's email. The assertion keeps the login path to one token exchange. The cost is that the ID token carries profile data that can be stale until the next login. The API must treat these values as login-time claims, not as a live directory.

Provisioning must reconcile the application settings on every run with `PUT /management/v1/projects/{projectId}/apps/{appId}/oidc_config`. Zitadel returns `400 COMMAND-1m88i (No changes)` when the configuration already matches. Idempotent provisioning must treat that response as success.

### Role claim shape

With the project audience scope `urn:zitadel:iam:org:project:id:{projectId}:aud`, the ID token contains:

```json
{
  "urn:zitadel:iam:org:project:roles": {
    "clinician": {
      "<zitadel-organisation-id>": "<primary-domain>"
    }
  }
}
```

The outer key is the role key. The inner key is the Zitadel organisation ID. The value is the primary domain. The audience contains the OIDC client ID and the project ID. The API must request the project audience scope to receive the role claim. It must resolve the organisation from the inner key and must not assume one organisation.

### Authentication context

- `amr` was `["pwd"]` for a password login. The API can use this value for step-up decisions.
- `auth_time` is a Unix timestamp. A second authorization request reused the original `auth_time` while the Zitadel session was valid. This is expected single sign-on behaviour. A step-up request must force re-authentication.
- The token response contained an access token and an ID token. The test did not store or reuse the access token.

### Deactivation blocks a new login

Deactivating a clinician user with `POST /management/v1/users/{id}/_deactivate` stopped the next authorization request at the login-name step. The page showed:

```text
User is not active. Contact your administrator for more information.
```

Reactivation with `POST /management/v1/users/{id}/_reactivate` restored the account. Zitadel enforces deactivation when it creates a login. It does **not** revoke an existing Almonac session. The control database must enforce account suspension on every request (ADR-012).

### SMTP defaults are not persisted as a provider

The `ZITADEL_DEFAULTINSTANCE_SMTPCONFIGURATION_*` environment variables did not create a usable email provider in v4.20.1. The first initialization email failed with:

```text
could not create email channel
error="ID=QUERY-fwofw Message=Errors.SMTPConfig.NotFound Parent=(sql: no rows in result set)"
```

Almonac must create the provider through the Admin API and then activate it:

1. `POST /admin/v1/email/smtp` with `senderAddress`, `senderName`, `host`, `tls` and an empty `none` object.
2. `POST /admin/v1/email/{id}/_activate`.

A new provider has the state `EMAIL_PROVIDER_INACTIVE` in `POST /admin/v1/email/_search`. Creation alone is not sufficient. The local Compose stack no longer sets the ineffective SMTP environment variables. Production must configure its SMTP provider through deployment provisioning, not through unverified environment defaults.

The initialization email contains a link to `/ui/login/user/init` with `authRequestID`, `code`, `loginname`, `orgID`, `passwordset` and `userID`. The link returned HTTP 200 and the Activate User page, even though the stack used Login v2. The test did not complete the password-setting step.

### Helm chart defaults lag the pinned image

Chart `zitadel/zitadel` 10.4.0 declares `appVersion: v4.19.2`. ADR-013 pins Zitadel `v4.20.1`. A staging deployment must set both image tags explicitly:

- `image.tag=v4.20.1`
- `login.image.tag=v4.20.1`

With these values, `helm lint` passed and `helm template` rendered two Deployments, three Jobs, two Services, one Role and one RoleBinding. The default `replicaCount` is 1 for the API and for login. Production values must set both to at least 2. No cluster was available, so scheduling, probes, PodDisruptionBudgets and ingress behaviour remain unverified.

### A live login exposed a login-time bug

The product API completed a real authorization code flow against the local Zitadel instance. The first callback failed with a database check violation on `identity.app_user`:

```text
new row for relation "app_user" violates check constraint "app_user_last_login_check"
```

The API set `last_login_at` from its own clock before the database created the row. The row's `created_at` default was a few milliseconds later, so `last_login_at >= created_at` failed. `AppUserRepository.markLogin` now uses `greatest($2, created_at)`. A clock earlier than the row creation clamps to `created_at`. The integration test covers this case.

This failure was not visible to unit tests with a fake store or to a login test that used a future timestamp. The live path found it.

### The live session has the expected shape

The session response contained the synthetic doctor and an empty membership list, because no invitation existed for that user. The stored session had:

- the configured issuer `http://localhost:8080`;
- an OIDC `sid`;
- `amr` `["pwd"]` and AAL 1;
- `auth_time` before `created_at`;
- idle expiry before absolute expiry;
- a sealed `id_token_hint` with key version 1.

Logout returned a Zitadel end-session URL with an `id_token_hint`. Following it ended the Zitadel session and redirected to the post-logout URI. The local session returned `401` after logout. A second logout also returned `200` and a provider URL, but it added no second audit record. A replayed callback returned `401 UNAUTHENTICATED`.

The audit trail contained one `auth.login` and one `auth.logout` event for the session. Their metadata held only `session_id`.

## Not verified

- **Token tampering.** The live API verified a valid signature against the Zitadel JWKS. Unit tests reject a wrong signature, `alg: none` and an expired token. A tampered live token was not sent.
- **Deactivation against an existing Almonac session.** Zitadel user deactivation blocks a new login. The live session was not tested against a later Zitadel deactivation. The API must enforce account status on every request.
- **Step-up.** `prompt=login`, `max_age=0` and session rotation were not exercised.
- **Invitation completion and password reset.** The initialization email and landing page work. Setting a password, reusing the code, expiry and reset emails were not exercised.
- **Email failure handling.** Only Mailpit delivery was tested. Provider errors, bounces and retries are unverified.
- **Organisation discovery and per-organisation policy.** Only one organisation and one login policy were tested.
- **Project grants and cross-organisation users.** The locum membership path in ADR-011 needs a second organisation.
- **Kubernetes runtime.** The Helm chart lints and renders. No cluster was available to test scheduling, probes, PodDisruptionBudgets, ingress, HA PostgreSQL, backups, restore or an upgrade rehearsal.
- **Legal.** The AGPL-3.0 review and the production security review remain open gates.
