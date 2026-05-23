# Tasks: Auth RBAC Invitations Trial

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Auth/RBAC DB -> auth UI/services -> trial gates/tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | RBAC/invitation/trial schema | PR 1 | SQL and RLS proof. |
| 2 | Auth/MFA/invite UX | PR 2 | Depends on PR 1. |
| 3 | Trial soft-block wiring | PR 3 | Generation/upload guards. |

## Phase 1: Database
- [x] 1.1 Create `supabase/migrations/*_auth_rbac_trial.sql` with invitations, trial fields, and role constraints.
- [x] 1.2 Add RLS/helpers for Owner/Admin/Member and invitation acceptance.

## Phase 2: Services
- [x] 2.1 Create `frontend/src/services/authService.ts` with typed Supabase auth contracts.
- [x] 2.2 Update `frontend/src/services/types.ts` for invitation, MFA, and trial states.

## Phase 3: UI/Wiring
- [x] 3.1 Create `frontend/src/app/(auth)/` routes for login/signup/MFA/invite acceptance.
- [x] 3.2 Gate recipe generation and PDF upload paths on `TrialState`.

## Phase 4: Verification
- [x] 4.1 Test invitation valid/expired scenarios and role denial.
- [x] 4.2 Run lint, typecheck, and build.
