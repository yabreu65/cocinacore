# CocinaCore 🍳

SaaS multitenant de recetas asistido por IA.

## Stack
- **Framework:** Next.js (App Router) in `frontend/`
- **Database:** PostgreSQL (Supabase) with RLS (Row Level Security) and `pgvector`
- **AI:** Gemini / OpenAI for RAG over cookbook PDFs and personalized recipes

## Repository structure
- `frontend/` — Next.js app
- `supabase/` — migrations, schemas, RLS policies, and security tests

## Engineering gates
Before a change is merge-ready, run these commands from the repository root:

```bash
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm test
cd frontend && npm run build
```

If any gate fails, the change is not ready to merge.

## Type safety standard
Do not use `any` for application code or trust boundaries. Prefer:

- `unknown` for external data until it is narrowed
- runtime guards or schemas for untrusted API/database responses
- DTOs for domain and API contracts
- typed clients/generated types for Supabase and external services

## Secret handling
Server secrets must stay server-only. Do not expose Gemini keys, Supabase service-role keys, or similar secrets through `NEXT_PUBLIC_*` variables or client bundles.

## RLS proof
Multi-tenant reads and writes must prove tenant isolation. The current RLS fixture lives at:

```text
supabase/tests/rls_tenant_isolation.sql
```

Use it as the allow/deny proof for same-tenant access and denied cross-tenant access when changing Supabase policies or tenant-scoped data paths.

## Tenant security guarantees
- Shared database model with strict RLS and required `tenant_id` scoping on tenant-owned data.
- Deny-by-default posture: RLS-enabled tables allow access only through explicit policies.
- Platform Owner/global scope is separated from tenant roles and tenant memberships.
- Tenant role model is `owner | admin | member`, enforced with typed tenant context contracts.
- Runtime RLS evidence must be maintained in `supabase/tests/rls_tenant_isolation.sql` with explicit same-tenant allow and cross-tenant deny expectations.
