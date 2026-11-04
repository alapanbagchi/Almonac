# Runbook: Zitadel database restore

## Scope

This runbook restores the Zitadel PostgreSQL database from a backup or a point in time. Use it after data loss, corruption or a failed upgrade.

A restore is incomplete without the masterkey. The database holds ciphertext for keys and secrets. The masterkey is in the secret manager and in offline escrow (ADR-013). Loss of the masterkey means loss of the encrypted data.

## Preconditions

- The incident is declared and the restore point is agreed. Record the timestamp and the reason.
- Access to the masterkey, through the secret manager or the escrow procedure.
- Access to the backup or PITR console, with a role that can create a database.
- A maintenance window. Login will fail during the restore.

## Procedure

1. Stop writes to Zitadel. Scale the API and login Deployments to zero. Keep the ingress error page in place.
2. Record the current database size, the latest backup time and the target restore time.
3. Create a new database from the backup or the PITR point. Do not overwrite the damaged database. Keep it for investigation.
4. Point the Zitadel release at the new database, or restore in place if the platform requires it. Do not change the database name and role silently; record the change.
5. Confirm the masterkey secret is present and is exactly 32 bytes. Do not print it.
6. Start one Zitadel API replica. Wait for readiness. Check the log for setup or migration errors.
7. Run a login for a synthetic account. Confirm the session, the dashboard and logout.
8. Scale the remaining replicas. Restore traffic.
9. Confirm that audit events after the restore point are known to be lost and record the window.
10. Keep the damaged database until the post-incident review closes.

## Verification

- A user can log in through the web app.
- The API returns a session for the new token.
- Logout revokes the session.
- The audit sink receives new events.
- No secret appears in logs or the incident record.

## Known gaps

- No backup, PITR or restore drill has run. The procedure is unverified.
- The RPO and RTO are unresolved (U-05). Until they are set, "acceptable loss" has no definition.
