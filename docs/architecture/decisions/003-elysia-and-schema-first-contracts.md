# ADR-003: Elysia for the API, with the schema as the contract

- **Status:** Proposed (nothing implemented)
- **Date:** 2026-11-03
- **Deciders:** Backend, Frontend, Architecture
- **Related:** ADR-001, `apps/api/AGENTS.md`

## Context

Almonac's API is consumed by the Next.js frontend and, later, by integrations and the clinical AI service. The team needs one definition of each request and response that is enforced at runtime, visible in TypeScript, and publishable as OpenAPI so external consumers and generated clients do not drift.

Node frameworks considered: Express, Fastify, Elysia, NestJS.

## Decision

Use **Elysia** on Bun for the API, with:

- Feature modules in four files: `model.ts` (schemas), `index.ts` (routes), `service.ts` (business rules), `repository.ts` (SQL).
- Elysia's `t` (TypeBox) schemas attached to every route for params, query, body and response.
- Types inferred from schemas (`typeof schema.static`); no hand-written duplicate interfaces.
- OpenAPI generated from the route definitions, served in development and published as a build artifact.
- A single error envelope produced by an error plugin, with stable codes.

The schema is the contract. A route without a response schema is incomplete, because it would silently publish anything the handler returns.

## Consequences

Positive:

- Validation, OpenAPI and TypeScript types come from one source, so they cannot drift.
- Response schemas prevent accidental field leaks (a missing `select` fails validation instead of exposing a column).
- Handlers stay thin and testable through `app.handle(new Request(...))` without a listening socket.
- The domain/feature layout maps directly to the bounded contexts in ADR-001.

Negative:

- Elysia runs on Bun; the rest of the repository uses Node tooling. This is a real operational split (two runtimes, two image bases) and must be documented in `infrastructure/AGENTS.md` when containers exist.
- Elysia's API changes between minor versions; pinning is mandatory.
- TypeBox schemas are verbose for deeply nested clinical payloads.

## Alternatives considered

- **Fastify + Zod.** Mature and Node-native, but OpenAPI and types require an extra conversion layer that drifts in practice.
- **NestJS.** Strong structure, heavy ceremony for a small team, and decorator metadata makes the contract less explicit at the route.
- **tRPC only, no REST.** Excellent for the first-party frontend, but excludes external integrations and clinical AI services that need a language-neutral contract. Rejected; a typed client can still be generated from OpenAPI.

## Follow-ups

- Bun is confirmed as the API runtime (ADR-008); running on Node would require a new ADR, not a configuration flag.
- Decide whether the frontend consumes generated types from the OpenAPI document or a shared schema package; do not maintain both by hand.
- Add an OpenAPI diff check to CI so breaking changes fail review.
