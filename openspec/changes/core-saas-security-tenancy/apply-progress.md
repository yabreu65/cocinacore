## Apply Progress

- Change: `core-saas-security-tenancy`
- Mode: `hybrid`
- Batch: `verify-failures-runtime-sql-evidence`
- Date: `2026-05-22`

### Completed Tasks (cumulative)
- [x] 1.1 Create `supabase/migrations/*_security_tenancy.sql` with tenant type, roles, platform-owner helper.
- [x] 1.2 Update all tenant-owned policies to deny-by-default and require `tenant_id` scope.
- [x] 2.1 Update `frontend/src/services/types.ts` with `TenantType`, `TenantRole`, and `TenantContext`.
- [x] 2.2 Refactor `frontend/src/services/supabaseAdapter.ts` to accept typed tenant context.
- [x] 3.1 Add SQL fixtures proving same-tenant access and cross-tenant denial.
- [x] 3.2 Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [x] 4.1 Document tenant security guarantees in `README.md`.
- [x] Follow-up verify slice: add runtime SQL evidence for platform-owner allow, tenant-owner deny, invalid tenant type rejection, and deny-by-default no-policy behavior.

### Evidence Added
- Updated `/Users/yoryiabreu/proyectos/cocinacore/supabase/tests/rls_tenant_isolation.sql`:
  - Added platform owner insert-allowed assertion on `public.global_books`.
  - Added tenant owner insert-denied assertion on `public.global_books`.
  - Added invalid tenant type rejection assertion through `auth.users` insert (`22P02`).
  - Added deny-by-default RLS assertion using a no-policy probe table (`42501`).

### Frontend Gates
Executed in `/Users/yoryiabreu/proyectos/cocinacore/frontend`:
- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅
- `npm run build` ✅

### Delivery Boundary
- Mode: `ask-on-risk` follow-up test-only slice
- Scope: tests/fixtures/evidence only
- Implementation code touched: none
