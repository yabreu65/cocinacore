## Implementation Progress

**Change**: auth-rbac-invitations-trial  
**Mode**: Standard  
**Delivery path**: chained PRs (`stacked-to-main`)  
**Current slice**: Slice 4 / Phase 4 verification (tasks 4.1, 4.2)

### Completed Tasks
- [x] 1.1 Create `supabase/migrations/*_auth_rbac_trial.sql` with invitations, trial fields, and role constraints.
- [x] 1.2 Add RLS/helpers for Owner/Admin/Member and invitation acceptance.
- [x] 2.1 Create `frontend/src/services/authService.ts` with typed Supabase auth contracts.
- [x] 2.2 Update `frontend/src/services/types.ts` for invitation, MFA, and trial states.
- [x] 3.1 Create `frontend/src/app/(auth)/` routes for login/signup/MFA/invite acceptance.
- [x] 3.2 Gate recipe generation and PDF upload paths on `TrialState`.
- [x] 4.1 Test invitation valid/expired scenarios and role denial.
- [x] 4.2 Run lint, typecheck, and build.

### Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `frontend/src/app/(auth)/layout.tsx` | Created | Added shared auth route-group layout with minimal navigation. |
| `frontend/src/app/(auth)/login/page.tsx` | Created | Added minimal functional login form route. |
| `frontend/src/app/(auth)/signup/page.tsx` | Created | Added minimal functional signup form route. |
| `frontend/src/app/(auth)/mfa/page.tsx` | Created | Added minimal MFA code entry route. |
| `frontend/src/app/(auth)/invite/[token]/page.tsx` | Created | Added invite acceptance route with token display. |
| `frontend/src/services/ragEngine.ts` | Modified | Added `TrialState` guards to block recipe generation/PDF ingestion when trial permissions are false. |
| `frontend/src/services/authService.ts` | Modified | Added invitation-expiry helper and role-management capability helper used for typed policy checks. |
| `frontend/src/services/__tests__/authService.test.ts` | Created | Added unit tests for invitation valid/expired scenarios and member role-denial capability. |
| `supabase/tests/rls_tenant_isolation.sql` | Modified | Added pgTAP fixtures/assertions for owner invite creation, member invite denial, valid invite acceptance, and expired invite rejection. |
| `openspec/changes/auth-rbac-invitations-trial/tasks.md` | Modified | Marked phase 4 tasks complete. |

### Deviations from Design
None — implementation matches design.

### Issues Found
None (all required frontend validations passed).

### Remaining Tasks
- [ ] None.

### Workload / PR Boundary
- Mode: stacked PR slice
- Current work unit: Unit 3 finalization (verification/tests closeout)
- Boundary: invitation validity/expiry + role-denial tests and full frontend validations
- Estimated review budget impact: low-medium

### Validation Evidence (frontend)
- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅ (4 files, 10 tests passed)
- `npm run build` ✅ (Next.js production build successful)

### Status
8/8 tasks complete. Ready for verify.

---
Topic key mirror: `sdd/auth-rbac-invitations-trial/apply-progress`

## Follow-up Patch (CRITICAL verify gaps)

Date: 2026-05-22
Scope: focused test-evidence patch for auth runtime + trial gating.

### Added Evidence
- Email/password runtime session creation: covered in `frontend/src/services/__tests__/authService.test.ts` (`creates a session for email/password sign-in at runtime`).
- Google OAuth runtime flow with no extra in-app 2FA: covered in `frontend/src/services/__tests__/authService.test.ts` (`starts google oauth flow and does not require extra in-app 2FA for privileged roles`).
- Mandatory Owner/Admin 2FA enforcement (password provider): covered in `frontend/src/services/__tests__/authService.test.ts` (`enforces mandatory 2FA enrollment for owner/admin password users`).
- Expired-trial read allowed while generate/upload blocked: covered in `frontend/src/services/__tests__/ragEngine.test.ts` via direct read/search call allowed and action-path blocks validated.

### Validation
- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅ (5 files, 15 tests)
- `npm run build` ✅
