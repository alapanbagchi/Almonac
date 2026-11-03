# ADR-011: Organisation and hospital tenancy

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Backend, Security, Product
- **Related:** ADR-001, ADR-002, ADR-004, ADR-010, U-09

## Context

Almonac serves organisations that own hospitals. A hospital owns clinical data and has its own database (ADR-002). An organisation contracts with Almonac, employs administrators and can own several hospitals.

Staff do not always follow this boundary:

- A clinician can work at two hospitals in one organisation.
- A locum can work at a hospital owned by another organisation.
- An organisation administrator can manage every hospital in the organisation but must not read patient records.
- A person can change employer and keep the same identity.

ADR-001 rejected one database per hospital for all data, including users. That model duplicates identity and breaks cross-hospital staff. ADR-010 selected Zitadel. A Zitadel organisation is a tenant vessel for users and projects. It is not a clinical authorisation model. Almonac must map the two models with care. A poor mapping can leak access or create duplicate people.

## Decision

**The Almonac tenancy hierarchy is Organisation to Hospital. Identity is global. Authorisation is local to a hospital.**

### Model

- An **organisation** owns zero or more hospitals. It is the commercial and administrative boundary. It owns branding, contracts and organisation-level administrators.
- A **hospital** is the clinical and data boundary. It has one database (ADR-002), its own credentials, its own migration state and its own audit stream.
- A **user** is one global identity. One person has exactly one `app_user` row and one Zitadel user in one home organisation.
- A **membership** connects a user to a hospital or to an organisation. It has a status and one or more roles. Membership, not the Zitadel organisation, is the source of access.
- A user can hold memberships in hospitals that belong to any organisation. A cross-organisation locum is a normal case.

### Mapping to Zitadel

- A Zitadel organisation corresponds to an Almonac organisation. It holds that organisation's users, projects and login policy.
- A hospital is **not** a Zitadel organisation. If it were, each hospital would duplicate users and cross-hospital staff would fail.
- A user's home organisation is where Almonac created the Zitadel user. It determines the login policy and identity lifecycle. It does **not** determine which hospitals the user can access.
- The login name is the person's real work email, for example `jane.doe@hospital.example`. Login names are globally unique. A person keeps the same identity when Almonac adds a membership at another hospital.
- Verify organisation domains in Zitadel for domain discovery and branding. Verify hospital domains in the control database. This prevents an organisation from claiming a domain it does not control. A hospital domain does not need to be a Zitadel organisation domain unless it is also used for organisation discovery.

### Authorisation

- Every hospital route resolves a hospital selector and then checks for an **active** membership for the authenticated user at that hospital. The selector is a lookup key only. It is not proof.
- Permissions are operation-specific, for example `patient.read`, `note.sign` or `staff.manage`. Roles on the membership provide the permissions. There is no implicit "organisation administrator can see patients" path.
- An organisation-scoped membership grants administrative capabilities over the organisation's hospitals, such as create hospital, invite staff and read audit. The role decides the capabilities. This membership does not grant clinical permissions.
- Cross-tenant lookups return 404. A known resource that the actor cannot access returns 403 only when its existence is not sensitive. The route decides once, in a central location.
- Platform administrators use a separate audited break-glass path (ADR-004). They do not get a hidden superuser branch in hospital routes.
- A suspended or revoked membership takes effect on the next request. Access does not continue until the session expires.

### Invitations

- To invite a person who does not exist, create a Zitadel user in the organisation that owns the hospital. Use no password. Send the Zitadel initialization email. A local invitation row tracks the pending membership.
- To invite a person who already exists in any organisation, create only a local invitation token bound to that person's `zitadel_sub`. Do not create a duplicate Zitadel user.
- Acceptance requires an authenticated session with the same subject as the invitation. A different account cannot redeem a forwarded invitation link.
- A membership becomes active only after acceptance. An unaccepted invitation never grants access.

## Consequences

Positive:

- One person, one identity, many hospitals. Cross-organisation locums work without duplicate accounts or shared credentials.
- Clinical authorisation is explicit and local. Organisation ownership never becomes clinical access without a membership.
- A hospital can move between organisations, or an organisation can be renamed, without changes to identity.
- The data boundary (one database per hospital) matches the authorisation boundary.

Negative:

- Almonac must keep two hierarchies consistent through provisioning code and reconciliation checks.
- With a cross-organisation membership, the login policy comes from the home organisation and the access comes from another organisation. The API must enforce the target hospital's multi-factor authentication (MFA) and authenticator assurance level (AAL), and its session age. It must not assume that the home policy is sufficient.
- Organisation deletion, hospital transfer and staff offboarding need explicit workflows. Nothing can cascade by accident.
- Email is both a login identifier and a contact address. An email change is an identity operation with verification, not a profile edit.

## Alternatives considered

- **Hospital as the Zitadel organisation.** This gives a clean one-to-one mapping. It duplicates staff per hospital, breaks one identity across sites and makes cross-organisation locums impossible without a second account. Rejected.
- **Organisation-wide clinical access.** This is simple and wrong. Ownership of a hospital is not consent to read its patients. Rejected.
- **Flat tenant model with only hospitals.** This is simpler, but it cannot express contracts, shared administration or multi-site ownership. Rejected.
- **Per-hospital user directories.** ADR-001 already rejected this model for the same reasons. Rejected.

## Follow-ups

- Define the exact role catalogue and permission keys before implementation.
- Define what happens when a hospital changes organisation: membership migration, audit and session invalidation.
- Define organisation deletion and hospital decommissioning, including data retention (U-06).
- Add a reconciliation job. It must report Zitadel users without `app_user` rows and memberships that point to missing users or hospitals.
- Project grants are not part of Almonac authorisation. Memberships are local. If a later phase uses Zitadel project grants for delegated administration, verify their behaviour first. Do not assume that they match the local membership model.
