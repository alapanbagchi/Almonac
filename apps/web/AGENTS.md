<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Almonac project preferences (recurring — do not re-litigate)

These are standing instructions from the product owner. Apply them to every UI task in this repo without asking again.

### Theme-first, always
- Use the design tokens defined in `src/app/globals.css` (`@theme`). Never hardcode hex values, never use raw Tailwind palette colours (`bg-emerald-500`, `text-gray-500`, …).
- Prefer the semantic aliases (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `ring-ring`, …) over brand tokens where a semantic one exists.
- The palette is four anchors and derived tints, nothing else: `ink` `#1E201E` (main background), `bark` `#3C3D37` (input surfaces, subtle borders), `moss` `#697565` (muted accents, secondary text, icons), `parchment` `#ECDFCC` (headings, primary text, buttons). Derived: `bark-raised`, `ink-raised`, `moss-bright` (small secondary text — pure moss fails AA below large sizes), `clay` (destructive only).
- Single dark theme. There is no `.dark` block and no light mode — do not add one.
- Never "hack around" a token with an inline style or arbitrary `[#hex]` class.

### Typography
- `font-display` / `font-serif` (Lora) for headings and editorial copy.
- `font-sans` (Söhne, local via `next/font/local`: Buch 400, Halbfett 500, Kräftig 600 + Buch italic) for everything else: UI labels, body, buttons, captions.
- Body text defaults to 14px (`text-sm` on `body` in `globals.css`); components opt out with explicit sizes.
- Do not substitute other typefaces.

### Components
- Prefer Spectrum UI components (registry `https://spectrumhq.in/r/<name>.json`) where one genuinely fits; install with `env npm_config_cache=/tmp/npmcache ./node_modules/.bin/shadcn add <item> --yes`.
- All other primitives come from shadcn/ui in `src/components/ui` (Base UI based — not Radix).
- `--dry-run` before adding; never swap Base UI primitives for Radix ones.
- Dashboard sidebar: `src/app/dashboard/layout.tsx` wraps all sections with `DashboardSidebar` (desktop aside + mobile top-bar/Sheet); the tree itself is `DashboardNav` (Overview + Manage/System collapsible groups with normal-case headers, active pill `bg-bark-raised/25`), shared by both shells — add new sections there and as stub pages under `src/app/dashboard/<section>/page.tsx`. Both shells end with the Spectrum `ProfileDropdown` (`src/components/spectrumui/profiledropdown.tsx`) and its sign-out form. The member name, role and hospitals come from the API session passed by the dashboard layout.

### Forms
- Two form patterns exist. A multi-field editor uses TanStack Form + Zod and sends every field through `ValidatedField` (`src/components/form/validated-field.tsx`): pass `form`, `name`, `label`, a zod `schema` and render the control from its `input`/`select` props — label, error message, ids and aria wiring come free.
- A short administration action (one to three fields, for example create organisation, add hospital, invite staff) uses a native `form` with HTML constraints. Do not add TanStack Form to a small action form. The API validates the request and remains the authority; client validation is UX only.
- Invalid styling is a primitive default, not per-form CSS: `Input` and `SelectTrigger` style `aria-invalid` with a clay border, clay-tinted background and clay ring (including focus/hover states); an invalid field also renders its label, text, placeholder and leading icon in clay until the error clears. Never add your own error colours.
- Both patterns submit through React. Use `SubmitButton` (`src/components/form/submit-button.tsx`) for the submit control: it stays disabled until hydration, so a native submit cannot reload the page with the fields in the query string. Do not use a bare `Button type="submit"` in a form that handles `onSubmit`.
- TanStack Form errors show after blur or submit — typing in a pristine field never flags it; once flagged, fixing clears live. Keep `noValidate` on those forms (no native bubbles) and do not use `required` there.
- Every `useForm` sets `canSubmitWhenInvalid: true` so submit always runs full validation (TanStack otherwise skips `validateAllFields` on attempt #1 when a coinciding blur already invalidated the form).

### Icons
- Icons come from the animate-ui hugeicons shadcn registry: `@animate-ui/icons-hugeicons-<name>` → `src/components/animate-ui/icons/hugeicons/`.
- Available: arrow-down-01, arrow-right-02, check, clock-01, globe-02, home-03, key-01, location-01, logout-01, mail-01, menu-01, settings-02, user-round. Re-add any other icon from the registry when a design needs it.
- `arrow-*-01` are chevrons; use `arrow-*-02` for real arrows. Eye/eye-closed come from the lucide variants.
- These icons render `stroke="currentColor"`, so colour them with text tokens.

### Assets
- Logo: `public/logo.svg` (abstract monogram mark, 1317×1194 viewBox; render via the `logo-mark` utility which masks it in parchment, e.g. `aspect-[1317/1194] w-[64px]`).
- App background: flat `bg-background` (#1E201E).
- Dashboard header shows the signed-in member's hospital memberships (`src/lib/auth/session-view.ts` maps the API session; logo `public/hospital/logo.svg`; organisation name as slogan). `HospitalSwitcher` only switches between verified memberships; adding a hospital belongs to the admin plane. `LogoTile` samples the logo at runtime: light logos get a dark tile, dark logos a light one.

### Working style
- The hard part is the layout in the reference image, not the design decisions. Match the reference and move on; don't invent alternatives or re-derive the design system.
- Verify visually (screenshot the running dev server) before declaring a UI task done.

### Environment gotchas
- `npm_config_cache` points at a read-only dir → always prefix shadcn/npm commands with `env npm_config_cache=/tmp/npmcache`.
- A dev server is normally already running on `:3000`; reuse it instead of starting another.
- Base UI `Select` options that aren't portalled/visible yet will fail Playwright clicks — target `[data-slot="select-item"]:visible`.
- Base UI `Checkbox` renders a `<span role="checkbox">`; click `[data-slot="checkbox"]` in tests.


---

# Web architecture rules

**Location.** The web application lives at `apps/web/` (ADR-009 supersedes ADR-007). The workspace root is the Git repository; `apps/web` is not a separate repository. Run commands from `apps/web/`.

**Installed baseline** (`package.json`): Next.js 16.4.3 (App Router), React 19.3, TypeScript 5 strict, Tailwind CSS 4 via `@tailwindcss/turbopack`, shadcn with the `base-nova` style on Base UI, TanStack Form 1.x, Zod 4, animate-ui icons. `next.config.ts` enables `cacheComponents` and `partialPrefetching`. The app has a server-only Eden client for `GET /api/health`, a server-side authentication BFF with step-up, an allowlisted administration BFF, an allowlisted break-glass BFF, a session reader, a guarded dashboard with a break-glass screen, and a Playwright suite. `.env.example` documents `API_URL` and `AUTH_PUBLIC_ORIGIN`. Dashboard memberships, hospitals and identity come from the API session.

## 1. Architecture

- App Router only. No `pages/`. Routes live under `src/app` as folders with `page.tsx`, optional `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`.
- Route groups `(auth)`, `(dashboard)` group layouts without adding a URL segment. Use a group only when several routes share a layout or a guard; do not create a group for a single page.
- A `layout.tsx` must not fetch user-specific data that its children also need; pass data down or refetch in the page. Layouts do not re-render on navigation.
- Server Components are the default. Add `'use client'` only for state, effects, browser APIs or event handlers, and push it down to the smallest leaf that needs it — a page or layout must not become a client component because one button is interactive.
- Every route that loads data needs a loading state (`loading.tsx` or `<Suspense>`) and an error boundary (`error.tsx` with a reset action). A clinical screen must never fail to a blank page.
- Data fetching happens on the server, in the page or a server-only module. Client fetching is for interaction-driven reads (search-as-you-type, polling a job) and mutations.
- Never import a module that touches `process.env` secrets or the database into a client component. Anything marked `server-only` stays server-side.

Verification: `grep -rn "use client"` should show leaves, not pages; every data route has a loading and error file.

## 2. Feature organisation

Organise by workflow, not by technical type. A feature owns its components, hooks, schemas and types:

```text
src/
├── app/                     routes only: layout, page, loading, error
├── components/
│   ├── ui/                  design-system primitives (shadcn/base-nova)
│   ├── spectrumui/          second design-system registry
│   ├── dashboard/           shell, navigation, hospital switcher
│   └── form/                form primitives (ValidatedField)
├── lib/                     framework-agnostic helpers, API client
└── hooks/                   reusable hooks only
```

| Kind | Lives in | Rule |
| --- | --- | --- |
| Design system | `components/ui`, `components/spectrumui` | Generic, no clinical or hospital concepts, no data fetching |
| Shared | `components/` root or `lib/` | Used by two or more features; promote only on the second use |
| Feature | `components/<feature>/` or `app/<route>/_components/` | Owns its domain vocabulary; may import design system and shared |
| Page | `app/**/page.tsx` | Composes; contains no business rules and little markup of its own |
| Layout | `app/**/layout.tsx` | Shell, navigation, providers; no page-specific data |
| Hook | `hooks/` or feature folder | One concern; no JSX; no direct fetch inside a generic hook |

Do not create a global component for something used once. A complex clinical component (medication timeline, vitals chart, order set editor) stays next to the route that owns it. Imports point downward only: `app` → feature → shared → design system → `lib`. A design-system component never imports a feature.

## 3. Talking to the backend

- The web client uses **Eden Treaty** against the exported `App` type for API routes; do not hand-write request/response types that Eden infers. The server-only auth BFF uses its own Zod-validated client in `src/lib/auth/api.ts` because it must never import server internals into the browser. Keep ad-hoc `fetch` out of components.
- Python services (`apps/clinical-ai`) are called through the Elysia API, not directly from the browser. If a browser call is ever required, generate a typed client from that service's OpenAPI document; do not retype schemas by hand.
- The browser never holds database credentials and never connects to PostgreSQL. There is no client-side SQL, no Supabase-style direct table access.
- Every request carries the authenticated session, never a user ID or hospital ID taken from local state as proof of identity. The hospital selector sends a hospital ID as a *selector*; the API re-authorises it.
- Handle the API's error envelope `{ error: { code, message, requestId } }` in one place and map codes to user-facing messages. Never render a raw server message containing internals.
- Apply timeouts and abort signals to client-side requests; show a retry affordance rather than an infinite spinner.

## 4. Clinical data in the browser

Clinical data is private by default. Treat every patient name, identifier, note, order and result as PHI.

Must not:
- Store PHI in `localStorage`, `sessionStorage`, IndexedDB or a cookie.
- Put PHI in URLs, query strings, route segments, page titles or the document title.
- Log PHI to the browser console, an error tracker, analytics or session replay.
- Cache a patient-specific API response in a shared cache (CDN, `use cache` with a global key, a service worker, a shared React cache keyed only by route).
- Render PHI into a page that is publicly cacheable.

Must:
- Scope any client cache to the session and the current hospital, and clear it on logout and on hospital switch — including request caches, form drafts and recently-viewed lists.
- Fetch clinical data per request with the user's credentials; never serve one user's response to another.
- Prefer server components for initial reads so PHI does not sit in client memory longer than needed.
- Require explicit review before persisting any clinical data in browser state; default is not to.
- Respect Next.js caching semantics: with `cacheComponents` enabled, `use cache` is opt-in and must never wrap a user- or patient-specific fetch. When unsure, do not cache.

Verification: search for `localStorage`, `sessionStorage`, `console.log`, `use cache` and confirm none receives patient data; confirm logout clears client state.

## 5. Fetching, pagination, mutations

- Server reads: fetch in the page/server module, pass plain serialisable props. Do not pass class instances or functions across the boundary.
- Lists are paginated server-side. Never fetch "all patients" and filter in the browser. Default page size is explicit, sorting and filters are server parameters, and the URL may carry non-PHI list state (page, sort) only.
- Mutations go through a server action or an API call, then revalidate the affected route. Do not mutate local arrays as the source of truth for clinical records.
- Optimistic updates are allowed only for reversible UI state (toggles, draft rows) — never for signing, ordering, dispensing or anything audited. Show pending, success and failure states.
- Search: debounce input, cancel in-flight requests, and do not put a patient name or identifier in the URL.
- Empty states are explicit ("No encounters recorded") and never imply that data is missing when the request failed. Distinguish empty from error.

## 6. Accessibility and quality

- Semantic HTML first: `button` for actions, `a`/`Link` for navigation, real `label` elements, headings in order, landmarks (`main`, `nav`, `header`).
- Every interactive control is keyboard reachable, has a visible focus state and an accessible name. Icon-only buttons need `aria-label`.
- Modals and drawers trap focus, restore it on close, close on Escape and label themselves with `aria-labelledby`.
- Colour is never the only carrier of meaning (status, alerts, validation).
- Contrast: body text meets WCAG AA on the dark background; `moss-bright` exists for helper text because `moss` alone fails at small sizes.
- Layouts work at 320 px and at large desktop widths; clinical tables scroll rather than clip.
- Loading, empty and error states are designed, not afterthoughts.
- Verify with keyboard-only navigation and the browser accessibility tree before calling a screen done.

## 7. Security headers and content security policy

- `src/proxy.ts` sets the response headers for every rendered document: a per-request nonce in `script-src` with `'strict-dynamic'`, framing denial (`frame-ancestors 'none'`, `x-frame-options: DENY`), `referrer-policy: same-origin`, a Permissions Policy, `nosniff`, and HSTS only when `AUTH_PUBLIC_ORIGIN` is https. Do not add `'unsafe-inline'` to `script-src` or widen the framing rules.
- A nonce only works on a request-time render. Every page that returns HTML exports `const instant = false` and awaits `connection()` from `next/server` in an async component; the build then reports the route as dynamic. `instant = false` alone does not make a route dynamic, and a static route serves scripts without a nonce that the browser refuses to run.
- `referrer-policy: same-origin` is deliberate. `no-referrer` makes Chromium send `Origin: null` on same-origin form POSTs, which the BFF origin check rejects with 403. BFF route responses still send `no-referrer` themselves.
- The policy lives in `src/lib/http/security-headers.ts`. Change it there, extend `src/lib/http/security-headers.test.ts`, and keep the `e2e/smoke.spec.ts` assertion: it reads raw HTML rather than `document.scripts` so dev-only injected scripts do not mask a missing nonce on the server output.

## 8. Before you finish

`npm run lint` and `npm run build` pass (build type-checks; `npx tsc --noEmit` is acceptable for a faster loop). No new `any`, no non-null assertions to silence the compiler, no unused imports. No PHI in logs, URLs or storage. New routes have loading and error handling. The diff touches only the feature you were asked to change. Report anything you could not verify, and do not claim a screen works because it renders.
