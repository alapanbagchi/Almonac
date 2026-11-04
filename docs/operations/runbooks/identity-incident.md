# Runbook: identity incident

## Scope

Use this runbook when a session token, signing key, OIDC client secret, Zitadel administrator account or the identity database is suspected compromised.

## Decide the scope first

| Signal | First action |
| --- | --- |
| One session token leaked | Revoke that session. |
| Many sessions or a signing key | Treat as a full identity compromise. Disable login, rotate keys, revoke all sessions. |
| OIDC client secret leaked | Rotate the client secret in Zitadel and in the API secret store. Restart the API. |
| Zitadel administrator account | Disable the account, review audit events, rotate machine credentials. |
| Database access | Follow the restore and masterkey procedures. Assume ciphertext exposure. |

## Revoke a session

The API has no operator endpoint for this. Revoke in the control database with a written reason:

```sql
update identity.web_session
set revoked_at = now(), revoke_reason = 'incident: <ticket>'
where id = '<session id>' and revoked_at is null;
```

The next request with that token fails with `401 UNAUTHENTICATED`. The session row stays for audit. Do not delete it.

To revoke every session for one user:

```sql
update identity.web_session
set revoked_at = now(), revoke_reason = 'incident: <ticket>'
where user_id = '<user id>' and revoked_at is null;
```

Record the count before and after. The runtime role cannot delete sessions; a migration or owner role performs this update, and the change is recorded.

## Rotate the OIDC client secret

1. Create the new secret in Zitadel for the web application.
2. Write it to the secret manager. Do not put it in Git or a ticket.
3. Restart the API. Login attempts that start before the restart fail; that is acceptable.
4. Confirm a login succeeds, then remove the old secret.

## Rotate the session sealing key

The sealing key protects the PKCE verifier and the logout hint. A new key version is allowed; old rows keep their version. Do not delete an old key version until its rows expire.

1. Generate a new 32-byte key under the next `SEALING_KEY_VERSION`.
2. Deploy it with the old version still available for decryption.
3. Wait for the longest session and login-attempt lifetime to pass.
4. Remove the old version.

## Disable a compromised Zitadel account

1. Deactivate the user in Zitadel. The next login fails with "User is not active".
2. Revoke that user's Almonac sessions with the SQL above.
3. Review `audit.event` for the account.
4. Do not delete the user. Deletion removes evidence.

## Verification

- The affected token returns 401.
- A new login succeeds for an unaffected account.
- Audit events exist for the revocation and the login.
- The incident record names the actor, the time and the reason, and contains no secret.

## Known gaps

- No alerting exists for failed-login spikes, token endpoint errors or certificate expiry.
- No central audit sink exists yet. The `audit.event` table is the only record.
