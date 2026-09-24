# Agent guide — Slump Bryggeri

Read [docs/implementation-package.md](docs/implementation-package.md) (product source of truth) and
[docs/architecture.md](docs/architecture.md) (decisions already made) before changing anything.
When a requirement is ambiguous, choose the simpler option that preserves the product principles.

**What to build next:** [docs/implementation-plan.md](docs/implementation-plan.md) — milestones in order, with
acceptance criteria and Brage's decisions. Work on a branch per milestone/task, open a PR, keep CI green,
and tick the plan's checkboxes in the same PR. Merging to `main` deploys (once the Cloudflare token is set).

## Commands

- `npm test` — all tests (unit + workerd integration). Must pass before you finish.
- `npm run typecheck` — must be clean.
- `npm run build`
- `npm run dev` — local app on :5173; sign-in codes are printed to the dev server log.
- `npm run db:migrate:local` — apply D1 migrations locally.
- After editing `wrangler.jsonc`: `npm run cf-typegen`.

## Rules that are easy to break

- **Brewery mode** is on in dev and production: no accounts; `requireUser` accepts a Better Auth session
  *or* the person chosen on the device (worker/auth/brewery-mode.ts). Never add routes that bypass
  `requireUser`/`requireMember` because "there is no login" — the code and membership still apply.
- **Authorization**: every brewery-scoped route lives under `/api/breweries/:breweryId/*` behind
  `requireMember()` (worker/routes/breweries.ts). Scope every query by `c.var.membership.breweryId`,
  never by an id from the request body. Non-members get 404. Add an isolation test for new resources
  in `tests/integration/authorization.test.ts`.
- **Immutability**: recipe versions, batch snapshots and equipment profile values are never updated —
  write a new version. DB triggers enforce this.
- **Calculations**: brewing maths lives only in `src/domain/brewing-calculations/` as pure functions
  with tests (known input, expected output, tolerance). Never let an LLM compute these values.
- **Domain code** (`src/domain/`) must not import React, the database or anything from `worker/`.
- **Atomic writes**: multi-table writes go through `atomic()` (D1 batch) in `worker/lib/db.ts`.
- **Migrations**: add a new file in `db/migrations/`; never edit an applied one. Keep
  `db/schema/database.ts` in sync. Better Auth column mapping lives in `worker/auth/auth.ts`.
- **UI language** is Norwegian (bokmål); code, comments and commit messages are English.
- **Definition of done** (§59): UI, mobile layout, loading/empty/error states, authorization,
  validation, tests, migration if needed.

## Conventions

- Frontend server state via TanStack Query hooks in `src/features/*/api.ts`; no global stores.
- Design-system components in `src/design-system/`; use tokens (`bg-surface`, `text-muted`,
  `text-primary-strong` …), not raw colours. Min 44 px touch targets, `tabular` for numbers.
- Numeric input: accept Norwegian decimal comma via `parseDecimal`.
- Brew log is generic: new event types need no schema change (`brew_events.type`).
