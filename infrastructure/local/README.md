# Local Zitadel stack

This stack is for development and CI only. It runs one single-replica Zitadel
deployment, the Login v2 UI, PostgreSQL, Mailpit and a development proxy. It is
not the production topology. See ADR-013.

## What runs

| Service | Purpose | Reachable at |
| --- | --- | --- |
| `proxy` | Single public origin, routes the login UI and API | http://localhost:8080 |
| `zitadel-api` | Zitadel API and OIDC provider | internal `zitadel-api:8080` |
| `zitadel-login` | Login v2 UI | http://localhost:8080/ui/v2/login/ |
| `postgres` | Zitadel database | internal only |
| `mailpit` | Catches email | http://localhost:8025 |

Only the proxy and Mailpit publish host ports. Both bind to 127.0.0.1.
PostgreSQL, the Zitadel API and the login container are reachable only on the
Compose network.

## Prerequisites

- Docker with Compose v2

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

The stack embeds `POSTGRES_PASSWORD` in a local connection URL. Letters and
digits avoid URL encoding problems.

Start the stack:

```sh
docker compose up -d --wait
```

The first start creates the database schema, the first instance, the
administrator and the login client. It does not create an Almonac project, OIDC
application, SMTP provider or users. Product provisioning is not implemented.

Keep `ZITADEL_MASTERKEY` unchanged while the database volume exists. A
different key makes the existing data unreadable.

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

This deletes the database and the setup volume. The next start creates a fresh
instance. There is no migration path for local data.

## Troubleshooting

- **Compose reports a required variable**: set the named variable in `.env`.
- **Masterkey error**: the key is not exactly 32 bytes. Generate a new key and
  reset the stack.
- **Masterkey changed after first start**: the existing data cannot be
  decrypted. Restore the old key or reset the stack.
- **Login page 404**: the login container is not healthy. Check
  `docker compose ps` and `docker compose logs zitadel-login`.
- **Port already in use**: change `PROXY_PORT` or the `MAILPIT_*_PORT` values
  in `.env`.
- **Admin sign-in fails**: the password must meet the Zitadel policy. If setup
  already ran, a change to `.env` does not update the existing user. Reset the
  stack.

## Security notes

- `.env` is ignored and must not be committed. The example file contains no
  secret values.
- The proxy and Mailpit bind to 127.0.0.1. Do not publish this stack on a shared
  network.
- The login-client PAT has a long expiry and lives in the Docker volume. The
  admin password is local only.
- Do not reuse these values in staging or production.
