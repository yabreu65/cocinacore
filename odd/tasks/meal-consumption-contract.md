# M1.6.1 — Meal consumption contract

## Objective
Close the backend contract for explicit planned-meal consumption: the user confirms “Ya cociné”; CocinaCore records one durable meal-consumption marker and decrements only safely quantifiable inventory inside the same transaction.

## Starting point
- Branch: `feature/meta1-m1-2-meal-planner-contract`
- Base HEAD: `2e7ba3c946bd18ba2949ea295e7449126a105a5b`
- Prerequisite integrated locally: `525da4f` (`feat(db): enforce canonical email identity`), which owns official migration 011; M1.6 consumption is migration 012.
- M1.5 is closed locally.
- Preserve unrelated `.atl/skill-registry.md` and `.codegraph/`.

## Product rule
**El usuario confirma; CocinaCore registra.** Purchasing never mutates inventory. Inventory consumption starts only from an explicit cooked-meal confirmation.
## Contract
- Stable meal identity: `(meal_plan_id, day_index, meal_type)`.
- Persist durable markers in `user_meal_plans.consumption_payload`.
- Lock the exact tenant+user meal-plan row with `FOR UPDATE` before checking idempotency.
- One transaction covers marker check, inventory decrements, `inventory_movements`, and marker persistence.
- Retry/double-click after a committed confirmation returns the existing result and performs zero new decrements.
- Inventory is tenant-scoped, matching the existing Inventory and Planner behavior.
- Unknown quantities, unknown/incompatible units, and untracked stock are never guessed.
- Never drive tracked inventory below zero; record unfulfilled tracked consumption as skipped/shortfall evidence.
- Every actual decrement writes `movement_type='recipe_consumption'` with plan provenance.
- No shopping-list mutation.
## Scope
1. Add trusted migration `012` for the consumption payload column.
2. Add typed, transactional meal-consumption repository/service behavior.
3. Add authenticated GET/POST API contract for consumption status/confirmation.
4. Add focused tests for validation, idempotency, safe decrement, provenance, and tenant/user isolation.
5. Run migration dry/config checks plus focused Node 20 gates.

## Out of scope
- Planner button/UI (M1.6.2).
- Full browser journey (M1.6.3).
- Shopping purchase → inventory mutation.
- Guessing quantities or converting unrelated unit families.
- Push, PR, staging, production, or M1.7.

## Tasks
1. [x] Trusted migration + manifest contract.
2. [x] Transactional consumption engine.
3. [x] Authenticated API + unit tests.
4. [x] Verification, cleanup, Guardian-reviewed commit, and M1.6.1 local closure.

## Verification evidence
- Official CocinaCore canonical-email prerequisite integrated locally as `525da4f`; it owns migration 011.
- Consumption migration is trusted migration `012_meal_plan_consumption.sql`; manifest is continuous 001–012.
- Static migrator contract: PASS.
- `db:migrate:dry`: PASS for 001–012.
- Bootstrap/migrator integration in isolated PostgreSQL: PASS (`fresh legacy extensions baseline roles locks transactions activation`).
- Focused M1.6.1 tests: 3 files / 16 tests PASS on Node 20.20.2; post-Guardian compatibility slice: 6 files / 49 tests PASS.
- Full unit gate: 47 files / 394 tests PASS after Guardian fixes (Guardian independently revalidated the full suite); prior PM full run was 47 files / 393 tests before the added malformed-evidence regression.
- TypeScript: PASS. ESLint: PASS. Production build: PASS. `git diff --check`: PASS.
- No production, staging, push, PR, shopping mutation, or M1.6.2 UI work performed.

## Local database note
- The existing developer DB was created in July and has a legacy two-column `schema_migrations` ledger with `011_mfa.sql`, `012_tenant_rls_stage.sql`, and `013_platform_operator_stage.sql`; those migrations are not part of the current trusted mainline manifest.
- The current migrator correctly fails closed on that drift before applying migration 012.
- No legacy ledger row, MFA object, tenant RLS object, platform-operator object, or local data was deleted or rewritten.
- M1.6.1 migration correctness is therefore proven against isolated fresh/legacy integration databases; aligning the long-lived local DB is a separate explicit operation before connected M1.6.2/1.6.3 runtime validation.


## Guardian closure
- Guardian Angel first review correctly rejected shallow persisted-JSON typing and an optional manual DB-row field.
- Fixed by recursively validating decrement/skip evidence, enforcing meal-key consistency, and making `UserMealPlanRow.consumption_payload` required to match `NOT NULL`.
- Compatibility fixtures now include `consumption_payload: {}` explicitly.
- Post-fix Guardian review: **STATUS: PASSED**.
- Code commit: `4837684` (`feat(meal-plan): add idempotent meal consumption`).
- M1.6.1 status: **CLOSED locally**.
