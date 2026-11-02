# ADR-007: The web app stays in `frontend/` until an explicit migration

- **Status:** Superseded by ADR-009 (the app lives in `apps/web/`; `frontend/` did not hold it)
- **Date:** 2026-11-03
- **Deciders:** Architecture, Frontend
- **Supersedes:** the layout assumption in the Pass 1 scaffold (m00001)
- **Resolves:** U-01 in `docs/architecture/unresolved-decisions.md`

## Context

The agent-instruction scaffold was specified against a monorepo shape: `apps/api`, `apps/web`, `apps/clinical-ai`, `apps/worker`. The actual repository does not have that shape. The only implemented application is `frontend/`: a Next.js App Router project with its own Git repository (`.git` inside `frontend/`), its own lockfile and node_modules, and a dirty working tree containing in-progress dashboard, design and registration routes.

Two documents now described different realities — the scaffold's `apps/web/` and the code in `frontend/` — which is exactly the ambiguity this handbook exists to prevent.

## Decision

`frontend/` is the authoritative location of the web application until an explicit, separately approved migration. `apps/web/` remains an empty reserved directory.

Consequences for documentation and agents:

- All path references for the web app point at `frontend/` (`frontend/src/app`, `frontend/package.json`, `frontend/AGENTS.md`).
- `apps/web/AGENTS.md` applies to `frontend/` today, and moves with the app if it is ever moved.
- `apps/web/` must not receive code, a second copy, or a symlink to `frontend/`.
- A move is a dedicated change, not a side effect of a feature: preserve Git history (subtree/filter-repo, not copy-delete), get explicit approval, and update this ADR and every path reference in the same change.

## Consequences

Positive:

- One documented truth; no agent has to guess which directory holds the app.
- The user's uncommitted work in `frontend/` is untouched.
- The target monorepo shape is still recorded for when the backend exists.

Negative:

- The handbook has one indirection: `apps/web/AGENTS.md` describes code living elsewhere.
- `frontend/`'s own Git repository means the root is not a single Git root; cross-cutting changes (root AGENTS.md, skills, ADRs) are unversioned until a root repository is initialised. That is a separate decision and is not resolved here.

## Alternatives considered

- **Move `frontend/` to `apps/web/` now.** Cleanest final layout, but rewrites or discards the app's history, breaks its relative paths and risks the user's uncommitted work for a naming preference. Rejected; available later under the migration procedure above.
- **Duplicate the app into `apps/web/`.** Two copies drift immediately. Rejected.
- **Symlink `apps/web` → `../frontend`.** Looks like the target layout while hiding the real path, and breaks on platforms and tools that do not resolve it. Rejected.

## Follow-ups

- Initialise a repository at the workspace root (or document why the app remains a nested repository) before cross-cutting files need versioning.
