# Almonac Infrastructure

**Status: partially implemented.** `infrastructure/local/compose.yaml` runs a development-only Zitadel identity stack (proxy, Zitadel API, login UI, PostgreSQL, Mailpit) on 127.0.0.1. It creates the first instance and an administrator. It does not create an Almonac project, OIDC application, SMTP provider or users. There is no Dockerfile, Terraform configuration or CI deployment pipeline yet, and no cloud provider has been chosen. Treat every service definition below other than the local identity stack as a target to implement, not a description of what exists.

The Next.js app in `apps/web/` and the local identity stack run on a developer machine. Nothing is deployed.

## 1. Environments

Three environments, separate accounts/projects and separate state:

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Data | Synthetic only | Synthetic or de-identified | Real PHI |
| Database | Local containers | Managed, isolated | Managed, private, encrypted |
| Secrets | Local env file, never committed | Secret manager | Secret manager, separate from staging |
| Access | Developer laptop | Team, restricted | Break-glass + audited roles |
| Backups | None required | Daily, restore-tested monthly | Tested schedule + PITR |
| Domain | localhost | Staging domain, no public clinical use | Restricted |

No environment shares credentials, buckets, databases or encryption keys with another. Staging must never receive a copy of production data.

## 2. Containers

- One Dockerfile per deployable app (`apps/api`, `apps/clinical-ai`, `apps/worker`, `apps/web`). No "everything" image.
- Multi-stage builds: dependency install, build, then a minimal runtime. No compilers, package caches or dev dependencies in the final image.
- Run as a non-root user with a fixed UID, read-only root filesystem where possible, and no shell needed at runtime.
- Pin base images by digest or exact version, never `latest`. Rebuild on a schedule to pick up patches.
- `HEALTHCHECK` or platform probes hitting the app's health endpoint; never a TCP check alone.
- No secrets in build args, image layers or `ENV`. Runtime configuration is injected.
- Images are scanned for known vulnerabilities in CI; a critical finding blocks release unless explicitly waived with a reason.

## 3. Local Compose

Compose is for local development and CI, not production:

- The local identity stack is `infrastructure/local/compose.yaml`: Zitadel, its login UI, PostgreSQL, Mailpit and a development proxy. It is synthetic and binds to 127.0.0.1. Its README documents the required values and the start and reset steps.
- PostgreSQL services for control, one demo hospital and terminology are still target state; add them as separate services with separate volumes and no shared runtime role.
- A local object store (S3-compatible) for document uploads instead of writing to a developer's disk inside the container is still target state.
- Do not bake secrets into images or committed files. Leave secret values blank in the example env file and document how to generate them.
- After the developer sets the required values, `docker compose up` must give a working stack from a clean clone. If it needs manual SQL, that is a bug in the seed script.
- Health checks and dependency ordering so `up` does not race migrations or setup.

## 4. Networking and PostgreSQL

- Managed PostgreSQL, not a database on the application host.
- Private network only: no public IP, no `0.0.0.0/0` ingress, security groups limited to the application subnets.
- TLS required for every connection (`sslmode=verify-full` with a pinned CA), including service-to-service.
- Each application environment gets its own database instance or cluster for control and terminology; hospital databases may share an instance but each keeps its own database, role and pool (see ADR-002).
- Database roles: separate roles for migrations (DDL) and runtime (DML). The runtime role is not the owner and cannot create roles or databases.
- `pg_hba`/network policy allows only the API, worker and migration job — not the public internet, not developer laptops (use a bastion or a scoped tunnel).
- Connection limits are set per service and per hospital pool so one tenant cannot exhaust the cluster.
- `pg_stat_statements`, slow-query logging and connection-count alarms are enabled.

## 5. Secrets

- Managed secret store (cloud secret manager or equivalent). Never in Git, never in an image, never in a `.env` committed to the repository.
- One secret per purpose, with an owner and rotation policy. Database credentials rotate without redeploying where the platform supports it.
- Applications read secrets at startup through workload identity, not long-lived static keys where avoidable.
- No secret is logged, returned in an error, included in a crash dump or printed by a debug endpoint.
- CI uses short-lived OIDC credentials to the cloud provider, not a stored access key.
- A leaked secret is rotated first, then investigated. Removing it from Git history is not remediation.

## 6. Encryption and keys

- TLS 1.2+ in transit, encryption at rest for databases, volumes, backups and object storage.
- Application-level encryption for the most sensitive fields (national identifiers, free-text notes where required) using a KMS-managed key; envelope encryption with a data key per record or per hospital.
- Keys are per environment. Production keys are not accessible to developers or staging.
- Key rotation is planned and tested; rotating a key must not require re-encrypting every row synchronously.
- Do not invent a custom cipher. Use the platform KMS and a vetted library.

## 7. Object storage

- Private buckets by default; public access blocked at the bucket level.
- Clinical documents are encrypted, versioned and access-logged.
- Uploads use short-lived presigned URLs scoped to a key and method; downloads use short-lived signed URLs, never permanent public links.
- Object keys are opaque identifiers, never patient names or MRNs.
- Antivirus/content scanning before a document is made available to clinicians.
- Lifecycle rules delete temporary and orphaned objects; retention for clinical documents follows the (unresolved) retention policy.

## 8. Terraform

- All cloud resources are declared in Terraform, including databases, buckets, networks, secrets and IAM. No console-created production resources.
- Remote state with locking and encryption; state per environment. State is never committed.
- Separate root modules per environment or workspaces with distinct credentials — not one state with a `prod` flag.
- `terraform plan` is reviewed on every change; applies run in CI with a human approval for production.
- No `terraform destroy` in production pipelines. Deletion protection on databases, buckets and key stores.
- Modules are versioned and pinned. Provider versions are pinned.
- Drift detection runs on a schedule.

## 9. IAM and least privilege

- Each service has its own identity (task role, service account, workload identity) with only the permissions it needs: API reads/writes its databases and its bucket prefix; worker reads queues and its buckets; clinical-ai reads models and nothing clinical.
- No shared "app" role across services. No human account used by a service.
- Human production access is federated, MFA-protected, time-bound and audited. Standing admin access is not the default.
- CI deploy roles can deploy, not read production data.

## 10. Deployment

- The pipeline builds, tests, scans, pushes an immutable image tag, then deploys. The same image is promoted through environments; do not rebuild per environment.
- Deploy order for schema changes: expand migration → deploy compatible code → contract migration later. Never deploy code that requires a column before the migration that adds it.
- Health checks gate rollout; failed readiness rolls back automatically.
- Database migrations run as an explicit job, not in the web container's entrypoint.
- Zero-downtime expectations depend on the platform; if that is not configured, state it honestly.
- Every deploy records: version, commit, who approved, which environment, migration status.

## 11. Monitoring and logging

- Centralised logs, structured JSON, with request/trace IDs. No PHI in logs — enforce with a redaction layer and tests.
- Metrics: latency, error rate, saturation, database connections, queue depth, job failures, backup age.
- Alerts are actionable and routed; every alert has a runbook. Alert on symptoms (error budget burn, failed backups), not only CPU.
- Uptime checks for the public app and the API health endpoint.
- Audit logs for administrative and clinical access are separate from application logs and are tamper-evident.
- Dashboards exist before launch, not after the first incident.

## 12. Backups and disaster recovery

- Automated backups for every database, encrypted, in a separate availability zone or region as required by the (unresolved) DR target.
- Point-in-time recovery enabled for production; verify the retention window.
- Restore tests are scheduled and documented — a backup that has never been restored is unverified.
- Object storage versioning plus cross-region replication if the DR target requires it.
- Recovery point and recovery time objectives are **not decided**. Do not claim an RPO/RTO; record the current capability and the gap.
- Runbooks cover: database loss, region loss, secret compromise, ransomware, accidental deletion. Each names who decides and how to communicate.

## 13. Compliance

These controls support security but do not by themselves make Almonac HIPAA, GDPR or SOC 2 compliant. Compliance depends on jurisdiction, contracts, policies, training and audit — not on encryption alone.

- Do not claim compliance in documentation, marketing or code comments.
- Jurisdiction-specific obligations (data residency, retention, breach notification, BAA/DPA requirements) require legal review and are listed as unresolved decisions.
- Data residency must be decided before production data is stored; it constrains the cloud provider and region.

## 14. Review checklist

For any infrastructure change:

1. Which environment, and can it affect production?
2. Is the database reachable from anywhere it should not be?
3. Are credentials and keys least-privilege and managed?
4. Is data encrypted in transit and at rest, including backups?
5. Is the change reproducible in Terraform, or is it a manual console edit?
6. What is the rollback, and has it been tested?
7. Does it create a new copy of PHI, and is that copy justified and protected?
8. What alert or dashboard will show it failing?
