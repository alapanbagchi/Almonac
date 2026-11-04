# Runbook: Zitadel upgrade

## Scope

This runbook changes the Zitadel chart or image version. It also covers a failed upgrade.

Zitadel migrations are forward-only. A rollback is a database restore plus the previous image and chart (ADR-013). A schema downgrade is not supported.

## Preconditions

- A tested pair of chart and image versions. Chart 10.4.0 defaults to image v4.19.2, so set `image.tag` and `login.image.tag` explicitly.
- A current backup of the Zitadel database, and a known-good point for PITR.
- Access to the masterkey escrow. A restore without the masterkey loses the encrypted data.
- A staging environment with the same chart, image and PostgreSQL major version. Staging never receives production data.
- A written change record with the target version, the reason, the rollback point and the approver.

## Procedure

1. Read the Zitadel release notes for the target version. List breaking changes and required setup steps.
2. Restore the latest production backup into staging. Do not copy production data into staging for any other purpose; for this rehearsal, use a scrubbed copy or a synthetic instance that exercises the same migrations, and record which one you used.
3. Apply the target chart and image in staging with the production values, except for hostnames and secrets.
4. Record the timings: init Job, setup Job, pod readiness, first successful login, token issuance, console access.
5. Run the login smoke test in staging: sign in through the web app, open the dashboard, sign out, sign in again. Check the API session endpoint.
6. Run the same sequence on production during the agreed window. Apply through the pipeline, not from a laptop.
7. Watch the login error rate, token endpoint errors, pod restarts and database connections for 30 minutes.
8. Record the result and close the change.

## Failed upgrade

1. Stop the rollout. Do not run a second upgrade on top of a failed one.
2. Decide between a fix-forward and a restore. Fix-forward is acceptable only when the failure is configuration and the schema is intact.
3. For a restore, follow `zitadel-restore.md` to the pre-upgrade point, then deploy the previous chart and image.
4. Confirm login, session creation and logout before you announce recovery.
5. Write a post-incident record with the failed step, the data loss window and the follow-up action.

## Verification

- `helm status` shows the deployed revision.
- The init and setup Jobs completed.
- Both API replicas and both login replicas are ready.
- A real login through the web app succeeds.
- The audit sink receives the login event.

## Known gaps

- No production cluster exists. This procedure has not run against Kubernetes. The local Compose stack cannot rehearse init and setup Jobs.
- The first staging rehearsal is a gate before production use.
