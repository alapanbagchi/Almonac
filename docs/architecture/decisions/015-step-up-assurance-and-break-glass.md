# ADR-015: Step-up assurance and break-glass access

- **Status:** Accepted
- **Date:** 2026-11-04
- **Deciders:** Engineering
- **Related:** ADR-004, ADR-010, ADR-011, ADR-012, ADR-014

## Context

A clinician sometimes needs access outside their normal membership, for example
during an emergency at another hospital. This access is dangerous: it crosses a
tenant boundary, it is easy to abuse, and it must leave evidence. The control
schema already holds a time-boxed grant, an independent approver, a review
record and an append-only audit trail.

The API also needs a stronger session before it grants emergency access. ADR-012
defines step-up as a new OIDC authorization request with `prompt=login` and
`max_age=0`. The provider then authenticates the person again and the API
rotates the session token.

The original P6 plan required NIST AAL3 for break-glass. Zitadel sends AMR
values such as `pwd`, `mfa`, `otp`, `hwk`, `swk`, `webauthn`, `passkey`
and `pin`. The API maps any second factor to AAL2 but cannot prove hardware
binding, verifier impersonation resistance or the other properties that AAL3
requires. Claiming AAL3 from the AMR value alone would be false.

## Decision

1. A step-up request names the current user, forces fresh authentication
   (`prompt=login`, `max_age=0`) and keeps the same absolute session expiry.
2. A successful step-up rotates the opaque session token. The previous token is
   revoked in the same transaction, so replay fails immediately.
3. Break-glass requires AAL2 and an authentication time within five minutes.
   The API records the new AMR, AAL and authentication time on the session.
4. The API does not infer AAL3. It reports AAL2 at most and documentation must
   not describe break-glass as AAL3 until a provider signal supports it.
5. An emergency grant is active at creation and is read-only. A pre-approved
   grant is reserved by an approver and activated later by its subject.
6. The approver must differ from the subject. Emergency self-activation has no
   approver and is reviewed after the access window instead.
7. A grant lasts at most four hours. Overlapping open grants for the same person
   and hospital are rejected by an exclusion constraint.
8. Only the subject can activate a reserved grant. The subject or an approver can
   revoke. An independent approver reviews the grant after the window closes.
9. Every transition writes an audit event in the same transaction. If the audit
   write fails, the transition fails.
10. A grant is not an authorisation decision by itself. A clinical route must
    still check permission, tenant, membership and an active grant.

## Consequences

### Positive

- Emergency access remains possible when a clinician has a strong second factor.
- Fresh authentication limits the value of a stolen session.
- Token rotation makes step-up observable and replay-resistant.
- The four-hour cap, independent approval and post-hoc review bound the damage.
- The API states its assurance honestly instead of overclaiming AAL3.

### Negative

- A user with only a password cannot obtain emergency access. This is deliberate;
  the user must enrol a second factor first.
- AAL2 is weaker than the NIST AAL3 target for privileged emergency access.
- Review is manual. The system records the review but does not yet queue it,
  notify reviewers or block a reviewer who is inactive.
- Clinical routes do not exist yet, so no route consumes a grant.

## Alternatives considered

- **Require AAL3.** Rejected because the current provider mapping cannot prove it;
  this would block every emergency request while pretending to be stronger.
- **Accept AAL1 with a reason.** Rejected because a password-only session is the
  most likely stolen credential.
- **Issue a separate long-lived emergency token.** Rejected because it adds a
  second credential, a second revocation path and a second audit surface.
- **Skip step-up and rely on the session.** Rejected because Zitadel may reuse an
  existing SSO session and return the original `auth_time`.

## Follow-ups

- Add a review queue and notification for grants that need review.
- Return review state on the grant list so the screen hides grants that are already reviewed.
- Re-check whether Zitadel can supply a trustworthy AAL3 or hardware-bound signal.
- Consume active grants in the first clinical authorisation guard.
- Add an operations alert for emergency activation and for overdue reviews.
- Document the policy in the security runbook.
