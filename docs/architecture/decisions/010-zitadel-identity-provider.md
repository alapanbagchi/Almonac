# ADR-010: Zitadel as the identity provider

- **Status:** Accepted (engineering direction). Production use is gated on legal and security review.
- **Date:** 2026-11-03
- **Deciders:** Backend, Security, Product
- **Related:** ADR-011, ADR-012, ADR-013, ADR-004, U-07

## Context

Almonac is a multi-organisation, multi-hospital clinical system. Each request must identify the actor and the hospital. Authentication identifies the actor. Authorisation decides access to the hospital.

The identity function is large. It includes passwords, password reset, email verification, multi-factor authentication (MFA), passkeys, account lockout and session lifetime. Staff can work at two hospitals or move between organisations. An invitation must work for a new person and for a person who already has an account. A credential compromise is a patient-safety incident.

Almonac can build this function or adopt an identity provider. Building it requires control of password hashing, reset token rules, MFA enrolment, recovery codes, rate limits, breach detection and browser and authenticator defects. A small team can make a serious error in each area.

An identity provider can own credentials while Almonac keeps authorisation. Authorisation depends on the membership model. No generic provider understands that model. ADR-001 requires one identity, not one identity per hospital. ADR-004 requires server-side sessions and membership checks. This ADR selects the component that owns credentials.

## Decision

**Use Zitadel, self-hosted, as the OpenID Connect (OIDC) identity provider. Almonac keeps authorisation.**

Zitadel owns:

- Human credentials: passwords, password policy, reset, email verification, MFA (TOTP and WebAuthn/passkeys), recovery codes and lockout.
- The hosted login UI, including organisation discovery by verified email domain.
- The OIDC authorization endpoint, token endpoint, discovery document and JSON Web Key Set (JWKS).
- Identity lifecycle: create, deactivate, reactivate, delete and session termination.

Almonac owns:

- The mapping from an external identity to an Almonac user (`app_user.zitadel_sub`).
- Organisations, hospitals, memberships, roles and permissions (ADR-011).
- The API session that authorises Almonac requests (ADR-012).
- Every authorisation decision, including clinical access, break-glass and audit.

Integration rules:

- **Use the OIDC Authorization Code flow with Proof Key for Code Exchange (PKCE) and a confidential client.** Do not use the implicit flow. Do not use the password grant.
- **The API owns the flow.** The web app relays `code` and `state`. It does not exchange a code, hold the client secret or store a refresh token (ADR-012).
- **Verify the ID token at login only.** Check the issuer, audience, nonce, signature and time claims. Do not accept the ID token as an API access token.
- **Provision with the Zitadel management API.** Use a dedicated machine user and a scoped personal access token (PAT) or JWT. Human administrators use the Zitadel console for identity operations. They do not use it for Almonac authorisation.
- **Map one Zitadel organisation to one Almonac organisation** (ADR-011). A hospital is a local authorisation boundary. It is not a Zitadel tenant.
- **Use the person's real work email as the login name.** One person has one Zitadel user in one home organisation, even when they work at hospitals in other organisations.

Deployment is self-hosted only. Zitadel Cloud and managed identity services are out of scope. ADR-013 defines the deployment.

## Consequences

Positive:

- Zitadel maintains credential handling, MFA, passkeys, reset and the login UI.
- The API keeps a small authorisation model that matches clinical work.
- One global identity supports cross-organisation locums without duplicate accounts.
- OIDC is a replaceable boundary. A provider change affects discovery, client registration and claim mapping, not the session model.
- Each organisation can have its own login policy, branding and identity provider federation without new code.

Negative:

- Zitadel is another stateful service to run, upgrade, back up and monitor. Almonac owns its availability.
- Zitadel uses the **AGPL-3.0** licence. A separate internal service is the intended use. A modification or distribution needs legal review. This review is a release gate.
- The Zitadel database contains names, emails and credential material. It is sensitive even without clinical records. It needs the same access control, encryption, backup and incident response as the control database.
- The Zitadel organisation model is not the Almonac authorisation model. Almonac must maintain the mapping. The mapping must not become clinical policy.
- Provider upgrades can change login behaviour, claims or policy defaults. Pin the versions and rehearse each upgrade (ADR-013).

## Alternatives considered

- **Build identity in-house.** This gives maximum control and adds no service or AGPL obligation. Rejected because the security surface is large, the team is small and credential defects are patient-safety defects. It would also delay the clinical product by months.
- **Keycloak.** Keycloak is mature, uses Apache-2.0 and supports many protocols. It is a credible alternative. Rejected because it needs heavier operations, has a more complex administration surface and needs more login customisation for multi-organisation staff.
- **Auth0, WorkOS, Clerk or another SaaS.** These services give the fastest start and managed operations. Rejected because identity data would leave the deployment, the BAA and residency position is unverified and the system must be self-hosted.
- **Zitadel Cloud or a managed identity service.** This reduces operational work but conflicts with the self-hosting decision. Almonac would also depend on a vendor BAA for the login path. Rejected.

## Follow-ups

- Complete the legal review of AGPL-3.0 obligations for the deployment model. Record the result as a gate.
- Confirm the hosting provider, region and BAA position for identity data (U-03 and U-04).
- Define the machine-user credential strategy: PAT lifetime, rotation, scopes and storage. Never use a human administrator credential.
- Define the Zitadel backup and restore runbook, including masterkey escrow (ADR-013).
- The local verification recorded the ID-token claims, token-endpoint authentication and provider-side deactivation in `docs/security/zitadel-spike.md`. Logout propagation and project-grant behaviour remain unverified. Recheck them before the API authentication and administration work depends on them.
- Review the default login policy for clinical use: forced MFA, session lifetime, lockout and domain discovery.
