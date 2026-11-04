# Local development stack

This stack is for development and CI only. It runs one single-replica Zitadel
deployment, the Login v2 UI, the Zitadel database, a separate control database
and a development proxy. Email goes to a real SMTP relay that you configure;
the stack runs no mail catcher. It is not the production topology. See ADR-013.

## What runs

| Service | Purpose | Reachable at |
| --- | --- | --- |
| `proxy` | Single public origin, routes the login UI and API | http://localhost:8080 |
| `zitadel-api` | Zitadel API and OIDC provider | internal `zitadel-api:8080` |
| `zitadel-login` | Login v2 UI | http://localhost:8080/ui/v2/login/ |
| `postgres` | Zitadel database | internal only |
| `control-postgres` | Almonac control database and test database | `127.0.0.1:5433` |

Only the proxy and control PostgreSQL publish host ports. Both bind to
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

Add the authentication and administration variables:

| Variable | Local value |
| --- | --- |
| `ZITADEL_ISSUER` | `http://localhost:8080` |
| `ZITADEL_CLIENT_ID` | OIDC application client ID |
| `ZITADEL_CLIENT_SECRET` | OIDC application client secret |
| `ZITADEL_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` |
| `ZITADEL_POST_LOGOUT_URI` | `http://localhost:3000` |
| `SEALING_KEY` | 32 random bytes, base64url |
| `SEALING_KEY_VERSION` | `1` |
| `ZITADEL_SERVICE_USER_ID` | machine user ID |
| `ZITADEL_SERVICE_USER_KEY_ID` | machine key ID |
| `ZITADEL_SERVICE_USER_PRIVATE_KEY` | machine key, PKCS#8 PEM |
| `SMTP_URL` | real relay, for example `smtps://smtp.provider.test:465` |
| `SMTP_USER` | relay user name |
| `SMTP_PASSWORD` | relay password |
| `MAIL_FROM` | verified sender address |
| `MAIL_FROM_NAME` | display name, for example `Almonac` |
| `WEB_PUBLIC_ORIGIN` | `http://localhost:3000` |

The local Zitadel instance must contain an Almonac project, a web OIDC
application with that redirect URI, and a machine user with `IAM_OWNER`. The
product does not create these objects. Local provisioning is manual. Reset the
stack only when you can provision them again.

Then start the API:

```sh
cd apps/api
bun install
bun run db:migrate
bun run dev
```

Check readiness:

```sh
curl http://localhost:3001/health/ready
```

Start the web app in a second terminal:

```sh
cd apps/web
npm install
npm run dev
```

Create `apps/web/.env.local`:

```sh
API_URL=http://localhost:3001
AUTH_PUBLIC_ORIGIN=http://localhost:3000
AUTH_IDP_ORIGIN=http://localhost:8080
```

Run the tests:

```sh
bun run test              # unit tests, no database
bun run test:integration  # control database tests
bun test                  # all tests
```

The integration tests migrate the test database down and up. They do not use
the development database.

Migrations own the tables. They also create the `almonac_app` runtime role. The
API assumes that role on every connection. Readiness fails unless the schema
version is current and the runtime role cannot update or delete audit events.

## Sign in

Open http://localhost:3000/login. The page sends you to the Zitadel hosted login.
Sign in with an account that has an invitation or a membership.

The first Zitadel administrator, `admin@almonac.local`, can open the console at
http://localhost:8080/ui/console/ with the password in
`ZITADEL_ADMIN_PASSWORD`. The console is for local development only. The
production console is not public (ADR-013).

## Email

There is no mail catcher. Two senders use a real relay:

- **The API** sends the sign-up verification link and the invitation link.
  Set `SMTP_URL`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` and
  `MAIL_FROM_NAME` in `apps/api/.env`. Use `smtps://` on port 465, or
  `smtp://` on port 587 with STARTTLS. In production the API requires SMTP
  credentials, refuses a loopback host and requires STARTTLS on an `smtp`
  URL. It sends only the token link, never the token in a request line.
- **Zitadel** sends the initialisation mail for an invited user who has no
  password yet, and password-reset mail. Add an SMTP provider in the local
  console at http://localhost:8080/ui/console/ (Settings → SMTP) and activate
  it. Zitadel v4.20 does not persist
  `ZITADEL_DEFAULTINSTANCE_SMTPCONFIGURATION_*` as a provider.

The relay must be allowed to send as `MAIL_FROM`. Publish SPF, DKIM and DMARC
for that domain; many providers reject or quarantine a sender without them.
Test with a real mailbox before inviting staff. A failed send surfaces as a
503; the server does not retry silently.

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
- **Port already in use**: change `PROXY_PORT` or `CONTROL_POSTGRES_PORT`
  in `.env`.
- **No email arrives**: check the API log for `SMTP` errors, confirm the relay
  accepts `MAIL_FROM`, and confirm Zitadel has an active SMTP provider for
  initialisation mail.
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
- The proxy and control PostgreSQL bind to 127.0.0.1. Do not publish this
  stack on a shared network.
- The login-client PAT has a long expiry and lives in the Docker volume. The
  admin password and control database password are local only.
- The control database contains identity, authorisation and audit records, not
  patient records. It is still sensitive. Do not copy it to staging or production.
- Do not reuse these values in staging or production.
