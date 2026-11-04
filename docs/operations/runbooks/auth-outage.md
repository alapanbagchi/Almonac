# Runbook: authentication outage

## Scope

Users cannot sign in, or the API rejects every session. Diagnose in this order: web BFF, API, PostgreSQL, Zitadel, network.

## Triage

1. Check `GET /health` and `GET /health/ready` on the API. Readiness fails when the schema version or the audit privileges are wrong, not only when the database is down.
2. Check the web app. A missing or wrong `API_URL`, `AUTH_PUBLIC_ORIGIN` or `AUTH_IDP_ORIGIN` breaks login and logout. A missing `AUTH_IDP_ORIGIN` blocks the redirect to the provider, so the app session ends but the single sign-on session survives. The BFF fails closed with 503 when its configuration is invalid.
3. Check the control PostgreSQL: connections, disk, locks, long transactions.
4. Check Zitadel: API and login replicas, database, certificate expiry, SMTP.
5. Check the ingress and DNS for `auth.<domain>`.

## Common causes

| Symptom | Likely cause |
| --- | --- |
| 503 from the BFF | Web configuration missing or API unreachable. |
| 503 `AUTH_UNAVAILABLE` | Zitadel discovery or token endpoint unreachable. |
| 401 for every session | Wrong sealing key version, wrong database, or all sessions revoked. |
| 500 on login | Code exchange or ID token verification failed. Check the API log for the request ID and the sanitised error name. |
| 429 `RATE_LIMITED` | Rate limit hit. Read `Retry-After`. Do not raise the limit during an incident without a review. |
| Login loop | Cookie rejected. Confirm HTTPS, `__Host-` rules and the exact public origin. |

## Do not

- Do not disable TLS verification, the audit writer, the rate limiter or the bearer check to restore service.
- Do not widen a session or membership to test access.
- Do not restore an old database over a live one without the restore runbook.

## Recovery check

- A real user signs in, opens the dashboard, signs out.
- The API writes `auth.login_succeeded` and `auth.logout` audit events.
- `/health/ready` is ready.
- The incident record states the cause, the start and end time and the follow-up action.
