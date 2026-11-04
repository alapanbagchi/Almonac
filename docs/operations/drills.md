# Drills

A drill is an exercise with recorded evidence. A procedure that has not run is unverified. No drill has run against a real cluster.

## Record format

For each run, record: date, environment, operator, start and end time, result (pass or fail), data-loss window, evidence link and follow-up action.

## Drills before production

| ID | Drill | Blocking for | Last run |
| --- | --- | --- | --- |
| D-01 | Restore the Zitadel database to a point in time, with masterkey retrieval, and log in. | First real patient record | never |
| D-02 | Upgrade Zitadel from the current to the next patch version in staging and record timings. | First production upgrade | never |
| D-03 | Revoke one session and confirm the next request fails; revoke all sessions for one user. | Incident readiness | never |
| D-04 | Rotate the OIDC client secret with no login failure beyond the restart window. | Incident readiness | never |
| D-05 | Retrieve the masterkey with two custodians and restore into staging. | First real patient record | never |
| D-06 | Fail the API database and confirm `/health/ready` returns 503 and login fails closed. | First real patient record | never |
| D-07 | Exceed the login rate limit and confirm 429 with `Retry-After`. | First public deployment | never |
| D-08 | Confirm the audit writer failure blocks a login, not only logs it. | First real patient record | never |
| D-09 | Confirm the web app rejects a session cookie from another origin and a cross-site logout POST. | First public deployment | never |
| D-10 | Break-glass: request, activate, use, revoke and review one grant. | Clinical pilot | never |

## Results

No results yet. The local stack can exercise D-03, D-07, D-08 and D-10 against synthetic data, but it does not prove the production topology. D-01, D-02 and D-05 need a managed PostgreSQL and a Kubernetes cluster.
