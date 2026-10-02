# M1.6.3 — Full connected cooked-meal journey

## Objective

Close M1.6 with one real authenticated browser + PostgreSQL journey proving that explicit `Ya cociné` confirmation durably records the meal and decrements only the exact safe inventory quantity once.

## Starting point

- Branch: `feature/meta1-m1-2-meal-planner-contract`.
- M1.6.1 backend contract: CLOSED locally.
- M1.6.2 Planner UI code: implemented in `adc1a27`; documentary commit remains pending Guardian availability.
- Long-lived developer DB has legacy migration drift and must not be modified for this closure.
- Preserve unrelated `.atl/skill-registry.md` and `.codegraph/`.

## Connected contract

- Use a disposable pgvector PostgreSQL database migrated through official 001–012.
- Bootstrap one disposable authenticated owner only inside that database.
- Seed one owned canonical plan with one safely quantifiable ingredient and one untracked ingredient.
- `Ya cociné` is the only action that triggers consumption.
- The safe ingredient decrements exactly once and produces exactly one `recipe_consumption` movement with plan provenance.
- The untracked ingredient remains explicit skipped evidence; it is never guessed.
- The meal marker persists in `consumption_payload` and rehydrates as `Cocinado` after reload.
- Replay returns already-consumed semantics with zero additional decrement/movement.
- Cooking creates or mutates zero Shopping List rows.
- Cleanup removes only exact test-owned rows; the disposable database/container is destroyed after the run.

## Tasks

1. [x] Add connected browser/PostgreSQL consumption spec.
2. [x] Run it against a disposable migrated DB and fix only demonstrated defects.
3. [x] Run focused/full release gates required by changed scope.
4. [x] Guardian-reviewed commits and close M1.6 locally.

## Out of scope

Undo/reversal, manual consumption outside Planner, shopping purchase-to-stock mutation, M1.7, push, PR, staging, or production.

## Verification evidence

- Disposable `pgvector/pgvector:pg16` database created on a random localhost port; official migrations 001–012 applied successfully.
- Disposable `test@cocinacore.local` owner bootstrapped only inside that database; container destroyed after each run.
- New connected M1.6.3 journey: **1 passed / 0 failed**.
- Runtime proof: `1.25 kg → 0.25 kg` after explicit `Ya cociné`; one exact `recipe_consumption` movement with tenant/user/item/plan provenance; one `not_in_inventory` skip; durable `1:breakfast` marker; reload shows `Cocinado`; replay returns `alreadyConsumed=true` with inventory unchanged and movement count still 1; Shopping List row count remains 0; exact cleanup reaches zero leftovers.
- Focused M1.6 regression on Node 20.20.2: **4 files / 19 tests PASS**.
- Full unit gate on Node 20.20.2: **48 files / 397 tests PASS**.
- TypeScript: PASS. ESLint: PASS. Production build: PASS (**52 pages**). `git diff --check`: PASS.
- Full Playwright against a second disposable migrated database: **27 passed / 2 skipped / 0 failed**. The two skips are the existing owner-health cases that require explicit `E2E_OWNER_*` credentials.
- No product source change was required by M1.6.3; only the connected spec and ODD evidence were added.
- Long-lived developer DB was not altered. No push, PR, staging, production, or M1.7 work performed.

## Current closure state

- Connected spec commit: `ea44b7f` (`test(meal-plan): connect cooked meal consumption journey`).
- Guardian Angel: **STATUS: PASSED** with Codex CLI `gpt-5.6-sol`.
- M1.6.3 status: **CLOSED locally**.
- M1.6 overall status: **CLOSED locally**.
- No `--no-verify` bypass was used.
