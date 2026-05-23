# Design: Core SaaS Security Tenancy

## Technical Approach
Build on the existing Supabase migration (`supabase/migrations/20260521144343_init_schema.sql`) by tightening roles, tenant type, helper functions, and RLS. Keep tenant checks in PostgreSQL as the security boundary; Next.js service code only passes authenticated context.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Tenancy model | Shared DB + RLS + `tenant_id` | Database-per-tenant | Matches current schema and MVP cost; RLS is enforceable centrally. |
| Platform administration | Separate `platform_owners`/claim helper | Reuse `superadmin` tenant role | Avoids confusing SaaS admin with tenant membership. |
| Tenant type | Persist `home`/`professional` on `tenants` | Infer from UI/session | Limits and AI routing must be auditable server-side. |

## Data Flow
    Supabase Auth JWT -> RLS helpers -> tenant-scoped tables
                     └-> platform-owner helper -> global SaaS tables

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/*_security_tenancy.sql` | Create | Add tenant type, normalized roles, platform owner helper, stricter RLS. |
| `frontend/src/services/types.ts` | Modify | Add typed tenant, role, and platform ownership DTOs without `any`. |
| `frontend/src/services/supabaseAdapter.ts` | Modify | Carry typed tenant context only; rely on RLS for enforcement. |

## Interfaces / Contracts
```ts
type TenantType = 'home' | 'professional';
type TenantRole = 'owner' | 'admin' | 'member';
interface TenantContext { tenantId: string; role: TenantRole; tenantType: TenantType; }
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB | RLS permits own tenant and denies others | Supabase SQL policy tests with seeded tenants. |
| Unit | Role/type parsing | Type-safe fixtures and negative cases. |
| E2E | Tenant cannot see foreign data | Authenticated smoke flow once test runner exists. |

## Migration / Rollout
Create additive migration first, backfill existing `user/admin/superadmin` into Owner/Admin/Platform Owner mapping, then tighten constraints. Roll back by restoring old policies before dropping new fields.

## Open Questions
- [ ] Exact Supabase claim source for Platform Owner in production.
