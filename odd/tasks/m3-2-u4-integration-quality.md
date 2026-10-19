# M3.2 U4 — Recipe integration and quality

## Goal
Connect generated AI recipes to the persistent recipe library while preserving AI history, then validate the complete recipe lifecycle and tenant/user isolation with isolated connected E2E coverage.

## Constraints
- Work only in `feat/m3-2-recetario-inteligente`; do not start U5.
- Preserve `.atl/skill-registry.md`, `.codegraph/`, and unrelated `odd/tasks/m3-2-u0-e2e-target-hardening.md` changes.
- Never use local PostgreSQL 5433, production, Redis/shared services, deploy, or push.
- Use only uniquely named temporary isolated `M32-U4-*` containers/resources on the validated E2E ports; clean and verify only those resources.
- Preserve existing M1/M2/M3.1 behavior, AI history semantics, structured ingredients, and public ownership boundaries.

## Tasks
- [x] Extend generation/import contract so generated recipes expose the persisted AI-history ID and can be imported into `/api/recipes` with `sourceRecipeHistoryId`, without deleting or mutating history.
- [x] Add focused integration tests for generated structured ingredients, import mapping, duplicate warnings, and history preservation.
- [ ] Add isolated connected E2E coverage for create/edit/versions/restore/archive/search/import plus cross-user/tenant denial and existing recipe regressions.
- [ ] Run migration 016/017 validation, focused tests, TypeScript, ESLint, build, and E2E; fix only scoped failures and commit validated work units.

## Acceptance criteria
- Generated AI UI offers a safe import/save action that creates a persistent recipe from structured ingredients and preserves the source history row.
- Import links `sourceRecipeHistoryId`; it does not create an unstructured-only ingredient payload when structured data exists.
- Duplicate titles remain advisory and non-destructive.
- Connected E2E proves lifecycle transitions, search/filter visibility, import/history linkage, and inaccessible records across user/tenant boundaries.
- All requested checks report PASS, or a precise blocker is reported without claiming completion.

## Evidence
- U3 commits: `11ad656`, `171bbdf`.
- Existing generation persists `recipe_ai_history` with structured ingredients; current response lacks the persisted history ID.
- Existing E2E target guard requires Postgres `127.0.0.1:5435/cocinacore_local_db` and Redis `127.0.0.1:6381/<db>`.

## Validation evidence so far
- Focused Vitest: 5 files / 55 tests passed.
- `cd frontend && npx tsc --noEmit` — passed.
- Targeted ESLint — passed.
- `cd frontend && npm run build` — passed (only existing Sentry deprecation notices).
- `test-persistent-recipe-migration-contract.sh` — migration 016 contract passed.
- `test-persistent-recipe-api-contract.sh` — migration 017/archive contract passed.
- `env -u DATABASE_URL npm run db:migrate:dry` — listed migrations 001–017 without connecting.
- Playwright remains pending: required ports 5435/6381 are occupied by pre-existing `cocinacore-m31-e2e-*` containers; U4 must not stop or reuse those resources.

## Commit evidence
- `fe35fe8 feat(recipes): integrate AI imports and connected quality coverage`
