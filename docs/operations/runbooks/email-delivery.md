# Runbook: email delivery

## Scope

This runbook covers the two senders of authentication email:

| Sender | Messages | Configuration |
| --- | --- | --- |
| Almonac API | Sign-up verification link, invitation link | `SMTP_URL`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_FROM_NAME` |
| Zitadel | Initialisation mail for an invited user without a password, password reset | SMTP provider in the Zitadel instance |

The API sends its own mail with Node Mailer. It never retries silently: a failed
send surfaces to the caller as `503` (`AUTH_UNAVAILABLE` or the admin error).
The invitation row or pending registration may already exist; resend after the
relay is healthy.

## Provider requirements

1. A transactional relay that accepts authenticated SMTP submission.
2. A sender address on a domain you control. Publish SPF, DKIM and DMARC before
   the first send. Many providers quarantine a new domain without them.
3. TLS. Use `smtps://host:465` (implicit TLS) or `smtp://host:587`. In
   production the API requires credentials and sets `requireTLS` on an `smtp`
   URL, so a relay that cannot STARTTLS fails closed.
4. The relay must not be reachable only from a loopback address. The API
   refuses `localhost`, `127.0.0.1` and `[::1]` in production.

## Configure the API

Set the values in the secret manager, never in Git:

```text
SMTP_URL=smtps://smtp.provider.example:465
SMTP_USER=<relay user>
SMTP_PASSWORD=<relay password>
MAIL_FROM=no-reply@<your domain>
MAIL_FROM_NAME=Almonac
```

Restart the API. It exits at startup when a value is malformed and prints only
the variable name. A production start rejects missing credentials, a loopback
host, a non-https `WEB_PUBLIC_ORIGIN` and a multi-line sender name.

## Configure Zitadel

The API's SMTP settings do not affect Zitadel. Create and activate a provider in
the Zitadel instance:

1. Open the Zitadel console as an instance administrator, or call the Admin API:
   `POST /admin/v1/email/smtp`, then `POST /admin/v1/email/{id}/_activate`.
2. Use the same relay, sender address and TLS mode as the API.
3. Send a test password reset to a real mailbox.

Zitadel v4.20 does not persist `ZITADEL_DEFAULTINSTANCE_SMTPCONFIGURATION_*` as a
provider. Do not rely on those variables. For the Helm deployment, confirm the
SMTP keys against the pinned chart version before you change values.

## Verify

1. Sign up with a real address you control. The verification mail must arrive
   within a minute.
2. Open the link. The account becomes usable only after this step.
3. Create an organisation and invite a colleague. Both the API invitation and
   the Zitadel initialisation mail must arrive.
4. Check the API log for the metric line and any `SMTP` error. Logs never
   contain the token or the message body.

## Diagnose

| Symptom | Check |
| --- | --- |
| API start fails with `Invalid mail configuration` | The message names the variable; fix it. |
| `503` on sign-up or invitation, no message | Relay credentials, sender verification, SPF/DKIM/DMARC, provider suppression list. |
| API mail arrives, Zitadel mail does not | No active Zitadel SMTP provider. Configure it separately. |
| Mail arrives but the link is rejected | The token expired (30 minutes for verification, 7 days for invitations) or was already used. |
| Mail lands in spam | Publish DMARC and align the envelope sender with the From domain. |

## Rotate the relay credential

1. Create the new credential at the provider.
2. Update the secret, then restart the API. Zitadel keeps its own copy.
3. Revoke the old credential after both senders pass a test message.
4. Record the change, the time and the actor in the incident or change record.

## Do not

- Do not put SMTP credentials in `SMTP_URL`. The API rejects a URL with a user
  name or password.
- Do not add a mail catcher to a shared environment. It accepts mail for any
  recipient and stores message bodies.
- Do not log the message body, the token or the recipient address.
