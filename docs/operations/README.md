# Operations

This directory holds the procedures that keep authentication and the identity plane available. It is not a description of deployed infrastructure. No production environment exists yet.

## Status

- The local development stack is in `infrastructure/local/`. It is not a production target.
- Kubernetes, Terraform, CI deployment and the production database are not implemented.
- No drill in `drills.md` has been executed against a real cluster. Each drill is a blocking gate before the first real patient record.

## Runbooks

| Runbook | Use when |
| --- | --- |
| `runbooks/zitadel-upgrade.md` | You plan, apply or reverse a Zitadel version change. |
| `runbooks/zitadel-restore.md` | The identity database is lost, corrupt or must return to an earlier point. |
| `runbooks/masterkey-escrow.md` | You create, retrieve or rotate the Zitadel masterkey. |
| `runbooks/identity-incident.md` | A session, signing key, client secret or administrator account is suspected compromised. |
| `runbooks/auth-outage.md` | Login fails for many users, or the API cannot verify a session. |

## Rules

1. Read the runbook before the incident. Do not learn the procedure during an outage.
2. Record every action with time, actor, command and result. Keep the record with the incident.
3. Never copy a secret into a ticket, a chat message or a shell history. Refer to the secret by name.
4. Never apply an unreviewed `kubectl` or `helm` change to production by hand. Use the pipeline. The exception is a declared incident, and the change is recorded and reviewed afterwards.
5. A restore is complete only when a user can log in and open a session. A running pod is not evidence.
6. Report a drill result as it is. A procedure that has not run is unverified, not "ready".
7. The application has no endpoints that mint, list or delete sessions for an operator. Revocation is a database action with a written reason, or a Zitadel user action.

## Escalation

The identity plane is a hard dependency. If login is down, the incident is severity 1. Page the on-call engineer, then the security owner. Do not wait for a full diagnosis before you declare the incident.
