# Proposal: Core SaaS Security Tenancy

## Intent
Establish the MVP tenant model as a secure SaaS foundation: shared Supabase PostgreSQL database, strict RLS, explicit tenant scoping, and separate Platform Owner administration.

## Scope
### In Scope
- Tenant lifecycle with `tenant_id` on tenant-owned data.
- Deny-by-default RLS and authorization helpers for tenant and platform scopes.
- Tenant type captured as Home or Professional at signup.

### Out of Scope
- Billing and paid plans.
- Cross-tenant data sharing.
- Full admin analytics console.

## Capabilities
### New Capabilities
- `security-tenancy`: Tenant isolation, platform ownership, tenant type, and RLS safety requirements.

### Modified Capabilities
- None

## Approach
Extend existing Supabase schema/RLS around explicit roles, tenant type, and platform admin boundaries. Keep security checks server-side and validate tenant context on every read/write.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | Modified | Tenant fields, role constraints, policies, helper functions. |
| `frontend/src/services/` | Modified | Typed tenant-aware data contracts. |
| `frontend/src/app/` | Modified | Tenant onboarding entry points later. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tenant data leak | High | RLS tests and deny-by-default policies. |
| Platform role confused with tenant role | Med | Separate role enum and helper functions. |

## Rollback Plan
Revert the tenant/security migration and dependent service contracts before production data exists; after data exists, use reversible migrations preserving tenant ownership.

## Dependencies
- Supabase Auth JWT claims and RLS execution context.

## Success Criteria
- [ ] Every tenant-owned table has `tenant_id` and RLS.
- [ ] Platform Owner access is separate from Owner/Admin/Member.
- [ ] Tests prove no tenant can read/write another tenant's data.
