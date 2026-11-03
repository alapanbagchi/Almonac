# Local development stack

This stack is for development and CI only. It runs one single-replica Zitadel
deployment, the Login v2 UI, the Zitadel database, a separate control database,
Mailpit and a development proxy. It is not the production topology. See ADR-013.

## What runs

| Service | Purpose | Reachable at |
| --- | --- | --- |
| `proxy` | Single public origin, routes the login UI and API | http://localhost:8080 |
| `zitadel-api` | Zitadel API and OIDC provider | internal `zitadel-api:8080` |
| `zitadel-login` | Login v2 UI | http://localhost:8080/ui/v2/login/ |
| `postgres` | Zitadel database | internal only |
| `control-postgres` | Almonac control database and test database | `127.0.0.1:5433` |
| `mailpit` | Catches email | http://localhost:8025 |

Only the proxy, Mailpit and control PostgreSQL publish host ports. All bind to
127.0.0.1. The Zitadel API, the login container and the Zitadel database are
reachable only on the Compose network.

## Prerequisites

- Docker with Compose v2
- Bun, for `apps/api`

## First run

Copy the example environment file:

```sh
cp .env.example .env
```

Set the required values in `.env`:

| Variable | Requirement |
| --- | --- |
| `ZITADEL_MASTERKEY` | Exactly 32 bytes. Generate with `openssl rand -hex 16`. |
| `LOGIN_SESSION_COOKIE_SECRET` | At least 32 characters. Generate with `openssl rand -hex 32`. |
| `ZITADEL_ADMIN_PASSWORD` | Must meet the Zitadel default password policy. Use a password manager. |
| `POSTGRES_PASSWORD` | Letters and digits only. Generate with `openssl rand -hex 16`. |
| `CONTROL_POSTGRES_PASSWORD` | Letters and digits only. Generate with `openssl rand -hex 16`. |

The stack embeds `POSTGRES_PASSWORD` in a local connection URL. Letters and
digits avoid URL encoding problems. Use a different password for each database.

Start the stack:

```sh
docker compose up -d --wait
```

The first start creates the Zitadel database schema, the first instance, the
administrator and the login client. It also creates the control database and
the control test database. It does not create an Almonac project, OIDC
application, SMTP provider or users. Product provisioning is not implemented.

Keep `ZITADEL_MASTERKEY` unchanged while the database volume exists. A
different key makes the existing data unreadable.

## Control database

The control PostgreSQL service is separate from the Zitadel database. It uses
the values in `.env`:

| Setting | Default |
| --- | --- |
| Database | `almonac_control` |
| Test database | `almonac_control_test` |
| User | `almonac` |
| Host and port | `127.0.0.1:5433` |
| Password | `CONTROL_POSTGRES_PASSWORD` |

The init script creates the test database only when the control volume is
empty. If the volume already existed before the test database was added, reset
the stack.

Create `apps/api/.env` from `apps/api/.env.example` and set both URLs. Use the
password from `CONTROL_POSTGRES_PASSWORD`:

```sh
DATABASE_URL=postgresql://almonac:<password>@127.0.0.1:5433/almonac_control
TEST_DATABASE_URL=postgresql://almonac:<password>@127.0.0.1:5433/almonac_control_test
```

Then, from `apps/api`:

```sh
bun install
bun run db:migrate
bun run dev
```

Check readiness:

```sh
curl http://localhost:3001/health/ready
```

Run the tests:

```sh
bun run test              # unit tests, no database
bun run test:integration  # control database tests
bun test                  # all tests
```

The integration tests migrate the test database down and up. They do not use
the development database.

## Sign in

Open http://localhost:8080/ui/v2/login/ and sign in as `admin@almonac.local`.
Use the password in `ZITADEL_ADMIN_PASSWORD`.

The admin can open the console at http://localhost:8080/ui/console/. This is for
local development only. The production console is not public (ADR-013).

## Email

Mailpit runs at http://localhost:8025. The stack does not configure an SMTP
provider. Zitadel v4.20 does not persist the
`ZITADEL_DEFAULTINSTANCE_SMTPCONFIGURATION_*` environment values as a provider.
No email is sent until product provisioning adds and activates a provider.

## Reset

```sh
docker compose down -v
```

This deletes the Zitadel database, the control database and the setup volume.
The next start creates a fresh instance and empty control databases. There is
no migration path for local data.

## Troubleshooting

- **Compose reports a required variable**: set the named variable in `.env`.
- **Masterkey error**: the key is not exactly 32 bytes. Generate a new key and
  reset the stack.
- **Masterkey changed after first start**: the existing data cannot be
  decrypted. Restore the old key or reset the stack.
- **Login page 404**: the login container is not healthy. Check
  `docker compose ps` and `docker compose logs zitadel-login`.
- **Port already in use**: change `PROXY_PORT`, `MAILPIT_UI_PORT`,
  `MAILPIT_SMTP_PORT` or `CONTROL_POSTGRES_PORT` in `.env`.
- **Control database connection refused**: check that `control-postgres` is
  healthy and that `DATABASE_URL` uses port 5433.
- **Test database does not exist**: the control volume was created before the
  init script existed. Run `docker compose down -v` and start again.
- **Migration fails with authentication error**: check the user and password in
  `apps/api/.env`, then run `bun run db:migrate` again.
- **Admin sign-in fails**: the password must meet the Zitadel policy. If setup
  already ran, a change to `.env` does not update the existing user. Reset the
  stack.

## Security notes

- `.env` and `apps/api/.env` are ignored and must not be committed. The example
  files contain no secret values.
- The proxy, Mailpit and control PostgreSQL bind to 127.0.0.1. Do not publish
  this stack on a shared network.
- The login-client PAT has a long expiry and lives in the Docker volume. The
  admin password and control database password are local only.
- The control database contains identity and authorisation records, not patient
  records. It is still sensitive. Do not copy it to staging or production.
- Do not reuse these values in staging or production.
