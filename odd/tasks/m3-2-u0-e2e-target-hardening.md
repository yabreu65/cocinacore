# M3.2 U0 — Connected E2E target hardening

## Goal
Remove unsafe local PostgreSQL fallbacks from the six connected Playwright specs so every direct database pool requires the validated isolated E2E PostgreSQL/Redis target contract.

## Constraints
- Work only in `feat/m3-2-recetario-inteligente`.
- Do not modify `.atl/skill-registry.md` or `.codegraph/`.
- Do not touch containers/shared services, local original DB, production DB, migrations, deploys, npm install, or push.
- Preserve existing unrelated worktree changes.

## Tasks
- [ ] Replace the six connected-spec fallbacks with `validateE2ETargets(process.env).databaseUrl`.
- [ ] Run focused non-writing tests/static checks proving missing or unsafe E2E URLs fail closed.
- [ ] Record evidence and close with one functional Conventional Commit.

## Acceptance criteria
- No targeted connected spec contains a `5433`/local fallback.
- Each targeted spec requires both explicit E2E database and Redis variables through the shared validator.
- Existing validator tests pass without connecting to any database.
- `.atl/skill-registry.md` and `.codegraph/` remain untouched.

## Baseline evidence
- HEAD/base: `0611bea` (`feat/m3-2-recetario-inteligente`, `main`, `origin/main`).
- Existing worktree changes: `.atl/skill-registry.md` modified; `.codegraph/` untracked; neither is in scope.
- The already-hardened `shopping-to-inventory-consumption-connected.spec.ts` is the reference pattern.

## Verification evidence
- Static grep: all six specs import `validateE2ETargets` and use `.databaseUrl`; no local `5433` fallback remains.
- `git diff --check`: PASS.
- Static contract: all six specs now require `validateE2ETargets(process.env).databaseUrl`; no local `5433` fallback remains.
- Review follow-up: scoped `user_meal_plans` and `recipe_inventory_items` cleanup predicates by `tenant_id` and `user_id` in `meal-plan-shopping-connected.spec.ts`.
- Focused Vitest could not run because `frontend/node_modules/.bin/vitest` is absent; npm install was prohibited.
- No database, Redis, container, migration, deploy, or shared service was contacted.
- Global `/usr/local/bin/tsc --noEmit` could not typecheck the project because project dependencies/types are absent.

## Commit evidence
- `8e0b916` — `test(e2e): require isolated database targets`
- No push performed.
