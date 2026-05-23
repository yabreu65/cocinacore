# Tasks: Core SaaS Security Tenancy

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 700-1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | DB tenancy/RLS -> typed contracts -> smoke tests/docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Supabase tenant/RLS migration | PR 1 | Security boundary and SQL tests. |
| 2 | Frontend typed tenant contracts | PR 2 | Depends on PR 1. |
| 3 | Verification/docs | PR 3 | RLS proof and onboarding notes. |

## Phase 1: Foundation
- [x] 1.1 Create `supabase/migrations/*_security_tenancy.sql` with tenant type, roles, platform-owner helper.
- [x] 1.2 Update all tenant-owned policies to deny-by-default and require `tenant_id` scope.

## Phase 2: Contracts
- [x] 2.1 Update `frontend/src/services/types.ts` with `TenantType`, `TenantRole`, and `TenantContext`.
- [x] 2.2 Refactor `frontend/src/services/supabaseAdapter.ts` to accept typed tenant context.

## Phase 3: Verification
- [x] 3.1 Add SQL fixtures proving same-tenant access and cross-tenant denial.
- [x] 3.2 Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

## Phase 4: Docs
- [x] 4.1 Document tenant security guarantees in `README.md`.

## Apply Progress Log
- 2026-05-22: Added runtime SQL evidence for verify CRITICAL scenarios (platform-owner allow, tenant-owner deny, invalid tenant type rejection, and deny-by-default RLS with no policy) in `/Users/yoryiabreu/proyectos/cocinacore/supabase/tests/rls_tenant_isolation.sql`.
