# ODD Feature: Meal Planner Contract (META 1 / M1.2)

- **Status:** complete
- **Base SHA:** `9174f97bc042d2718cdc1972825405a34a14b2fa`
- **Starting branch:** `main`
- **Working branch:** `feature/meta1-m1-2-meal-planner-contract`
- **Scope:** Correct the Meal Planner mode validation and 7/14/30-day prompt contract.
- **Non-goals for M1.2.1:** Culinary profile wiring, RAG, persistence, shopping, consumption, Home OS, deployment, Contabo, and unrelated refactors.

## Tasks

1. **Explore current contract** — completed. Confirmed the UI sends `balanced_ai`, the schema rejects it, DB types/migration already include it, and the API hardcodes a seven-day prompt.
2. **Implement mode contract** — completed. `balanced_ai` is accepted by `MealPlanSchema`; the API preserves the existing non-inventory prompt behavior.
3. **Implement period contract** — completed. Added typed 7/14/30 day mapping and deterministic period-specific format instructions; the API no longer injects unconditional seven-day text.
4. **Add focused tests** — completed. Validation and period helper coverage is present and executes successfully after restoring the optional native Rolldown binding.
5. **Run verification** — completed. Focused tests pass: `npm test -- src/lib/validation.test.ts src/lib/meal-planner/prompt.test.ts` (52 tests). Full suite passes: `npm test` (239 tests). `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` pass. Tests emit expected Redis/health-check degradation warnings because local Redis is not configured.

## Evidence

- Runtime repair: `cd frontend && npm ci --include=optional` restored the lockfile-pinned `@rolldown/binding-darwin-arm64` package. No application behavior or dependency manifests changed.
- No production/database/Contabo access.
- Existing untracked `.codegraph/` is preserved and excluded from the commit.
- Commit: local work-unit commit created with `fix(meal-planner): align mode and period contract`.

## META 1 / M1.2.2 — Authenticated Household Inventory Context

- **Status:** complete
- **Base SHA:** `24545c4ef261b013c9ec2ae345fb35a997fb3734`
- **Objective:** Load the authenticated tenant's persisted inventory server-side for meal-plan generation, represent it deterministically with quantity/unit context, and keep the change read-only.
- **Non-goals:** Culinary profile wiring, RAG/library wiring, meal-plan persistence, shopping persistence, cooking/consumption, inventory movements, Home OS, deployment, Contabo, and unrelated refactors.

### Tasks

1. **Explore authenticated inventory flow** — completed. `/api/inventory` uses `requireTenant()` and `listInventoryItemsByTenant(tenant.tenantId)`; `/api/meal-plan` had no auth or persisted inventory lookup.
2. **Implement server-side inventory context** — completed. `/api/meal-plan` requires authenticated tenant context, loads `listInventoryItemsByTenant(tenant.tenantId)`, ignores browser-supplied inventory, and injects bounded quantity/unit context into both prompt branches.
3. **Add focused tests** — completed in source. Tests cover authenticated tenant lookup, exact tenant isolation, empty inventory, quantity/unit rendering, ignored browser inventory, and deterministic 120-item/200-character bounds.
4. **Run verification** — completed. Focused inventory tests pass: `npm test -- src/lib/meal-planner/inventory-context.test.ts src/app/api/meal-plan/route.test.ts` (7 tests). Full suite passes: `npm test` (246 tests). `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` pass.
5. **Create work-unit commit** — completed. Commit contains only this slice and the updated ODD feature document.

### M1.2.2 Evidence

- Inventory source and tenant boundary: `requireTenant(request)` provides the authenticated tenant; `listInventoryItemsByTenant(tenant.tenantId)` loads `recipe_inventory_items` scoped by `tenant_id`. Browser `inventory` payload is ignored.
- Inventory bound: at most 120 tenant-matching items, preserving repository order; ingredient name, quantity, and unit are whitespace-normalized and bounded to 200 characters each. Missing quantity is rendered as `cantidad no especificada`.
- Prompt behavior: both `inventory_to_menu` and non-inventory modes receive a labeled authenticated household inventory section; empty inventory renders `Sin inventario persistido para este hogar.`
- Verification: focused 7/7 tests and full 246/246 tests pass; typecheck, lint, build, and diff check pass. Expected Redis/health degradation warnings remain in tests because local Redis is not configured.
- Commit: local work-unit commit created with `feat(meal-planner): use household inventory context`.
