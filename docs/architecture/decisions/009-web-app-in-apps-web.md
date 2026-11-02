# ADR-009: The web app lives in `apps/web/`

- **Status:** Accepted
- **Date:** 2026-11-03
- **Supersedes:** ADR-007 (the web app stays in `frontend/`)
- **Resolves:** U-01 in `docs/architecture/unresolved-decisions.md`

## Context

ADR-007 recorded that `frontend/` held the Next.js application and that `apps/web/` was an empty reserved placeholder. Inspecting the tree on 2026-11-03 showed the reverse:

- `apps/web/` holds `package.json` (name `frontend`, `next` 16.4.3, `react` 19.3.0, Tailwind 4), `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package-lock.json`, `node_modules/`, and `src/app/` with `dashboard`, `registration`, `design` and `fonts` routes.
- `apps/web/.git` is the application's repository (`c562a6b Initial commit from Create Next App`, branch `main`, a dirty working tree).
- `frontend/` existed but held exactly one file, `frontend/src/components/onboarding/onboarding-flow.tsx`, whose imports (`@/components/onboarding/stepper`, `@/components/onboarding/success-illustration`, `@/components/spectrumui/status-badge`) only resolve from inside `apps/web/src`.

ADR-007's premise was therefore wrong, and two documents described a layout the tree did not have — the ambiguity that document exists to prevent.

## Decision

`apps/web/` is the authoritative location of the web application. `frontend/` does not exist and must not be recreated. No second copy, symlink or move is permitted without a new ADR.

Consequences:

- All path references for the web app point at `apps/web/` (`apps/web/src/app`, `apps/web/package.json`, `apps/web/AGENTS.md`).
- `apps/web/AGENTS.md` is the app's local rule file; it stays with the code.
- The stranded component moved to `apps/web/src/components/onboarding/onboarding-flow.tsx`; its missing imports are recorded below as an open item, not invented.
- The app also carried its own skill root, `apps/web/.agents/skills/` (six Vercel Next skills) and `apps/web/skills-lock.json`. Both moved to the workspace root so that `.agents/skills` stays the single root §7 requires.

## Consequences

Positive:

- One documented truth matching the tree; agents no longer look for the app in a directory that does not exist.
- The application keeps its Git history (`apps/web/.git`) untouched.

Negative:

- The workspace root is still not a Git root: root `AGENTS.md`, ADRs and `.agents/skills` remain unversioned. That remains open and is not resolved here.
- `apps/web/src/components/onboarding/onboarding-flow.tsx` references six modules that exist nowhere in the tree: `@/components/animate-ui/icons/hugeicons/arrow-left-02`, `@/components/animate-ui/icons/hugeicons/search-01`, `@/components/onboarding/stepper`, `@/components/onboarding/success-illustration`, `@/components/spectrumui/status-badge` and `@/components/ui/checkbox`. No route imports the file, but `tsconfig.json` includes `**/*.tsx`, so `tsc --noEmit` reports six `TS2307` errors until those components are written or the file is removed. Deleting or completing the feature is a product decision and is left open. A separate pre-existing error, `src/app/layout.tsx(34,50): error TS2304: Cannot find name 'LayoutProps'`, comes from running `tsc` without a build — the type is generated into `.next/types`, which does not exist yet.

## Alternatives considered

- **Honour ADR-007 and move `apps/web/` to `frontend/`.** Rejected: it moves a repository with five days of history and a dirty working tree to satisfy a document that misread the tree, and it discards the layout the application was actually built in.
- **Keep both documents and let agents guess.** Rejected: this is the failure ADR-007 itself was written to prevent.
