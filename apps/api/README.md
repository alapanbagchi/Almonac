# Almonac API

Bare Elysia 2 service on Bun. It owns the Control, Hospital and Terminology
domains; there is no database, authentication or tenant resolution yet.

## Run

Requires Bun (developed on 1.4.2).

```bash
bun install
bun run dev      # http://localhost:3001, watch mode
bun run start    # no watch
```

`PORT` defaults to `3001`; Bun loads it from `.env` (see `.env.example`).

## Check

```bash
bun test
bun run typecheck
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe: `{ "status": "ok" }` |
| GET | `/openapi` | Scalar API reference |
| GET | `/openapi/json` | OpenAPI 3.1 document |

Feature prefixes stay relative; the root path and versioning are undecided
(`docs/architecture/unresolved-decisions.md`, U-15).

Every failure uses one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found.", "requestId": "..." } }
```

`requestId` also appears in the `x-request-id` response header.

## Web integration

The Next.js app imports `App` from `src/app.ts` and calls the API through Eden
Treaty in `apps/web/src/lib/api/client.ts`. It reaches the API server-side only,
via `API_URL` (default `http://localhost:3001`), and exposes `GET /api/health`
as a proxy. Do not call this API from the browser.

## Layout

```text
src/
├── app.ts          composition root (exports App for Eden)
├── index.ts        opens the port
├── health/         liveness feature
├── plugins/        errors, OpenAPI
└── shared/         error envelope, AppError
```

Domain features follow the four-file layout in `AGENTS.md`. Read that file
before adding a route.
