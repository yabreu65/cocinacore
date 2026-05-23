# Tasks: Premium Recipe Board Reviews

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 800-1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Premium schema/RLS -> board services -> UI/reviews/moderation |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Premium schema and RLS | PR 1 | Publication/withdrawal safety. |
| 2 | Board service contracts | PR 2 | Depends on PR 1. |
| 3 | UI reviews/moderation | PR 3 | Public flow and reports. |

## Phase 1: Database
- [x] 1.1 Create `supabase/migrations/*_premium_board.sql` for premium recipes, reviews, reports, and statuses.
- [x] 1.2 Add RLS for published global read, creator withdrawal, Platform Owner visibility.

## Phase 2: Services
- [x] 2.1 Update `frontend/src/services/types.ts` with premium recipe, review, report, and attribution DTOs.
- [x] 2.2 Create typed service methods for publish, review, report, and withdraw operations.

## Phase 3: UI
- [x] 3.1 Add `frontend/src/app/premium/` board and detail routes.
- [x] 3.2 Add review, report, and creator-withdrawal actions with read-only non-creator UX.

## Phase 4: Verification
- [x] 4.1 Test no-opt-in publishing denial, cross-tenant read-only, duplicate review prevention, withdrawal visibility.
- [x] 4.2 Run lint, typecheck, and build.
