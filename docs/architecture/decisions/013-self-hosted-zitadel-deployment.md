# ADR-013: Self-hosted Zitadel deployment

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Backend, Security, Operations
- **Related:** ADR-010, ADR-012, U-03, U-04, U-05

## Context

ADR-010 selects Zitadel as the identity provider. The deployment model is fixed: **self-hosted only**. Zitadel Cloud and managed identity services are out of scope. Almonac owns the availability, upgrades, backups, keys and incident response of the identity plane.

Identity is a hard dependency of every login and every session. It holds names, emails, password hashes, MFA secrets and signing keys. If it fails, no user can log in. If it leaks, credentials across the estate are compromised.

The deployment must be reproducible and recoverable:

- No manual console changes that disappear on the next upgrade.
- No single replica, no single database and no masterkey that one engineer holds alone.
- No public administration console and no telemetry that sends identity data to a third party.
- A tested path for schema migrations, because Zitadel upgrades run database setup steps.

## Decision

**Run Zitadel on Kubernetes with the official Helm chart. Use a managed highly available (HA) PostgreSQL, Terraform and a continuous integration (CI) pipeline.**

### Topology

- Use a dedicated Kubernetes namespace, separate from the Almonac application workloads. Network policies allow only the ingress controller, the API provisioning egress and monitoring.
- Run **at least two stateless Zitadel API replicas**. Use pod anti-affinity across zones, a PodDisruptionBudget, readiness and liveness probes, and rolling updates with a surge.
- Run **at least two login UI replicas** with the same disruption and affinity rules. The login service is part of the login path. One replica is not sufficient.
- Use a managed, HA PostgreSQL in the same region as the cluster. Enable automated backups and point-in-time recovery (PITR). Use a dedicated database and role for Zitadel. Use TLS with a pinned certificate authority. The runtime role is not a superuser.
- Use one public ingress hostname, **auth.<domain>**, with TLS 1.2 or later, HTTP Strict Transport Security (HSTS), request-size limits and rate limiting. Do **not** expose the Zitadel console on the public hostname. Administrative access uses a separate hostname that is restricted to the operations network or VPN and requires MFA.
- Use a transactional SMTP provider with SPF, DKIM and DMARC aligned to the sending domain. Monitor bounces and complaints. Email content must contain no clinical data.
- Disable Zitadel ServicePing. Enable only the metrics and logs that operations need. Do not enable third-party analytics.
- Store database credentials and the 32-byte masterkey in the cloud secret manager. Use External Secrets or an equivalent controller. Never put them in Helm values, Git, CI logs or container images.

### Installation and upgrades

Pin the chart to a tested version (currently **zitadel/zitadel 10.4.0**) and the Zitadel image to an explicit tag (currently **v4.20.1**). Chart 10.4.0 defaults to image v4.19.2, so the release values must set `image.tag` and `login.image.tag` explicitly. The local stack pins the same image, so local behaviour matches the production deployment.

- **Init** runs once for each database, as a Helm pre-install and pre-upgrade Job with a deadline and retries. It creates the schema and database objects.
- **Setup** runs after init on every version change, as a separate Job. It applies the Zitadel setup steps, creates the first instance and writes machine credentials to Kubernetes Secrets. It does not run in the API container entrypoint.
- The API Deployment starts only after init and setup complete. Helm hook order and readiness enforce this.
- **Rehearse every upgrade** against a restored copy of the production database, with the same image and chart versions. Record the setup duration, migration output, login smoke test, token issuance, console access and rollback or restore time.
- A rollback is a database restore plus the previous image and chart. It is not a schema downgrade. Zitadel migrations are forward-only. Restore the pre-upgrade backup after a failed upgrade.
- Upgrade on a schedule. Apply security patches promptly. Apply feature releases deliberately. Never use floating tags.

### Masterkey and backup

- The masterkey is exactly 32 bytes. Generate it once and store it in the secret manager. Limit access to the Zitadel workloads and a break-glass operations role.
- Keep a copy in offline escrow with dual control. **Loss of the masterkey means loss of the encrypted data.** The database alone cannot recover it.
- Back up the Zitadel database daily and enable PITR. The restore runbook must include the masterkey retrieval step. Without it, the restore is incomplete.
- Run a restore drill at least quarterly and record the result. A backup that has never been restored is unverified.

### Configuration ownership

- Terraform owns the cluster, database, secret manager entries, DNS, TLS certificates and network policy.
- Helm values are in Git, with one values file for each environment, and CI applies them. Do not run `helm upgrade` from a laptop against production.
- Apply Zitadel instance settings through the management API with a reviewed, idempotent bootstrap job. These settings include login policy, MFA requirement, password policy, SMTP and domains. Do not apply them by clicking in the console. Treat console changes as drift.
- Keep the bootstrap job separate from the application API. It uses a dedicated machine user with the minimum scopes for organisation, project, application and user provisioning.

### Security posture

- Run as non-root with a read-only root filesystem where the chart allows it. Drop capabilities and enable seccomp.
- Do not expose a public database endpoint. The network policy allows only the Zitadel pods and the migration Job.
- Federate admin console access through the identity provider where possible. Make it time-bound and audited. Do not make standing local admin accounts the default.
- Retain audit logs for administrative actions and send them to the central audit sink, separate from application logs.
- Monitor the login page and API for error rate, latency, 5xx responses, certificate expiry and failed-login spikes. Each alert must have a runbook.

### Environments

Development uses the Compose stack in `infrastructure/local` with synthetic identities only. Staging uses a separate cluster, database and secret set with synthetic or de-identified data. Production is separate again. No environment shares credentials, keys, databases or backups. Staging never receives a copy of production data.

## Consequences

Positive:

- The identity plane is reproducible, reviewable and recoverable. It is not a one-off server.
- Two replicas and a managed HA database remove the obvious single points of failure.
- Explicit init and setup Jobs make upgrades observable. A restore can reverse a failed upgrade.
- Terraform and version-controlled Helm values make drift visible before an incident.
- Self-hosting keeps identity data in the chosen jurisdiction and under Almonac contracts.

Negative:

- Almonac owns 24/7 availability of the login path, including certificate, database and upgrade incidents.
- Good Zitadel operations need Kubernetes, PostgreSQL and identity skills. The team must write and rehearse the runbooks.
- Managed HA PostgreSQL, cross-zone replicas and PITR add cost and operational complexity.
- Upgrades are a scheduled project, not a single action. A delay increases security risk.
- Masterkey escrow is a process control. Engineering cannot verify it alone.

## Alternatives considered

- **Zitadel Cloud.** Rejected by the self-hosting decision and because the BAA and residency position is unverified.
- **Single virtual machine with Docker Compose.** This is simple, but it has no HA and no rolling upgrades. It is a single point of failure for every login. Rejected for production. It remains the local development model.
- **Kubernetes with hand-written manifests instead of the official chart.** This gives more control but more drift and more upgrade work. Rejected because the chart already provides init, setup, probes and login.
- **A database inside the cluster instead of managed PostgreSQL.** This is cheaper, but backups, PITR, failover and patching become Almonac work. Rejected for production.
- **Keycloak or another provider.** ADR-010 already considered these. The deployment shape would be similar, so this ADR does not reopen the provider choice.

## Follow-ups

- Select the cloud provider and region. Complete the BAA and residency review and record it (U-03 and U-04).
- Define the recovery point objective (RPO) and recovery time objective (RTO) for the identity database. Test the restore against them (U-05).
- Write the upgrade runbook and run the first staging upgrade rehearsal. Record the timings.
- Write the masterkey escrow procedure with dual control and an annual retrieval test.
- Define the break-glass procedure for console access when the identity provider itself is degraded.
- Add dashboards and alerts for login success rate, token endpoint errors, certificate expiry, database connections and backup age.
- Confirm chart and image compatibility for the pinned versions during the first staging deployment. Do not use an untested pair.
