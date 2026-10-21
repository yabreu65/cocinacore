# M3.2 Recetario Inteligente — U0–U4 audit

**Scope:** Code, tests, and contracts for M3.2 units U0–U4, based on supplied read-only exploration findings. This is not a production-readiness or release-approval record.

## Executive status

**Assessment: implementation evidence is substantial, with one confirmed medium validation gap and a medium client-side search/pagination risk.** The inspected schema/repository/API boundaries support tenant/user scoping and append-only recipe versions. The U4 task record reports connected lifecycle, import, and isolation coverage, but those tests were not rerun for this analysis. U5 production release/acceptance remains a separate gated activity; U0–U4 evidence does not establish production readiness.

## Evidence and findings

| Status | Severity | Area and evidence | Assessment / recommendation |
|---|---|---|---|
| Confirmed | Pass | Versioning and restore: `db/migrations/016_persistent_user_recipes.sql:62-117`; `frontend/src/lib/db/repositories/recipeRepository.ts:351-379,411-434` | Version rows are protected against updates and restore is represented as a new version. Preserve this append-only contract in future changes. |
| Confirmed | Pass | Forced tenant/user RLS and transaction context: `db/migrations/016_persistent_user_recipes.sql:62-117`; repository context and ownership: `frontend/src/lib/db/repositories/recipeRepository.ts:213-218` | Database and repository evidence supports scoped access through `app.tenant_id` / `app.user_id`. API identity is derived from authenticated context: `frontend/src/app/api/recipes/route.ts:16-25`. |
| Confirmed | Pass | Archive, import, duplicate advisory, and connected lifecycle coverage: `frontend/e2e/specs/recipe-persistent-connected.spec.ts:145-286`; API/repository behavior in `frontend/src/lib/db/repositories/recipeRepository.ts:411-434` | The inspected connected E2E source includes import/history, duplicate warning, lifecycle, and cross-tenant scenarios. This documents coverage present in source, not a fresh test run. |
| Confirmed | Pass | E2E target hardening: `frontend/e2e/database-target.ts:42-79` | Target validation is present to constrain connected E2E database/service targets. The U0 task record reports its tests passed; that claim was not rerun here. |
| Confirmed defect | Medium | `db/migrations/016_persistent_user_recipes.sql:1-22`; API validation in `frontend/src/lib/validation.ts:100-117` | Migration 016 checks tag count and nullability but does not enforce the API's category maximum of 100 characters or per-tag maximum of 50 characters. Database writes that bypass API validation can therefore exceed the API contract. Recommend an additive, reviewed database constraint migration aligned with API limits; do not alter historical migration bytes. |
| Confirmed risk | Medium | `frontend/src/app/recipes/RecipeLibraryClient.tsx:208-232`; repository API supports pagination/search at `frontend/src/lib/db/repositories/recipeRepository.ts:267-292` | The library requests `limit=100&offset=0` and filters only the loaded items locally, without passing search to the server. Results beyond the first page may be omitted, and search is limited to the loaded page. Recommend wiring server-side search/pagination or making the bounded result limitation explicit. |
| Unknown / low risk | Low | `frontend/e2e/specs/recipe-persistent-connected.spec.ts:254-286` | A connected cross-tenant denial scenario is present, but same-tenant/different-user denial is not demonstrated by the inspected connected E2E. Confirm whether repository/API contract tests cover this case and add a connected scenario if necessary. |
| Confirmed improvement | Low | `frontend/src/app/recipes/recipe-ui.ts:31-74`; scale tests `frontend/src/app/recipes/recipe-ui.test.ts:22-50` | Add boundary tests for zero/negative/non-finite or otherwise invalid servings and quantities, as applicable to the helper's accepted input contract. Existing tests cover core scale behavior; this is a coverage improvement, not a reported defect. |

## Assumptions and unknowns

- **Confirmed:** Findings above are limited to the supplied code/test references; no production system was accessed.
- **Reported:** U0–U4 task records report focused tests, type/lint/build checks, isolated DB validation, and connected E2E outcomes. These are records of prior execution, not independently rerun evidence in this analysis.
- **Unknown:** Whether same-tenant/different-user denial is covered by tests outside the connected E2E file inspected.
- **Unknown:** User-perceived behavior for libraries exceeding 100 recipes without server-side search/pagination; this requires an appropriate test or browser observation.
- **Unknown:** Whether existing stored rows violate the category/tag limits; no live or database data was inspected.
- **Unknown:** Production migration, deployment, recovery, and authenticated acceptance state. U0–U4 evidence must not be used to infer U5 completion or production readiness.

## Evidence boundary

Task-record test claims were **not rerun in this analysis**. This document records source inspection and supplied findings only. It authorizes no migration, deployment, production access, or data mutation.
