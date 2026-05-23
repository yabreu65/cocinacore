# Tasks: Recipe AI Inventory Restrictions

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 700-1000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | DB/domain contracts -> AI service updates -> UI/history/rating |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Inventory/restriction/history schema | PR 1 | Includes RLS tests. |
| 2 | Recipe AI typed services | PR 2 | Depends on PR 1. |
| 3 | UI flow and ratings | PR 3 | Includes smoke tests. |

## Phase 1: Database
- [x] 1.1 Create `supabase/migrations/*_recipe_ai.sql` for inventory, restrictions, history, and ratings.
- [x] 1.2 Add tenant/member RLS and unique rating constraint.

## Phase 2: Services
- [x] 2.1 Update `frontend/src/services/types.ts` with inventory, restriction, history, and rating DTOs.
- [x] 2.2 Update `frontend/src/services/ragEngine.ts` for empty-inventory search and restriction overrides.
- [x] 2.3 Update `frontend/src/services/gemini.ts` prompt input to enforce restrictions.

## Phase 3: UI
- [x] 3.1 Add inventory, search, history, and rating screens under `frontend/src/app/`.
- [x] 3.2 Hide internal AI model tier language from UI copy.

## Phase 4: Verification
- [x] 4.1 Test allergy default, override, empty inventory search, and duplicate rating behavior.
- [x] 4.2 Run lint, typecheck, and build.
