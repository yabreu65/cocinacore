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

## Local Development with Docker

The current Compose file is intentionally small: it starts auxiliary services only.
Run the Next.js app directly from `frontend/` during local development.

```bash
docker compose up -d
cd frontend
npm install
npm run dev
```

This will start:
- Redis on port `6379` through Docker Compose.
- Next.js on http://localhost:3000 through `npm run dev`.

Supabase local development is managed by the Supabase CLI, not by `docker-compose.yml`.

## Supabase Local Development

Initialize and start Supabase locally:

```bash
supabase start
```

This uses the configuration in `supabase/config.toml` and applies migrations from `supabase/migrations/`.

## Deployment

The project includes a deploy workflow (`.github/workflows/deploy.yml`) that currently
validates staging and production builds. Real deployment is intentionally not wired yet;
connect it after the target host is selected.

### Required secrets
- `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`
- `PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY`
- `SENTRY_DSN`

### Hosting options

**Vercel (recommended for Next.js):**
1. Connect GitHub repo to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploys happen automatically on push to main

**Docker / Self-hosted:**
```bash
docker build -t cocinacore .
docker run -p 3000:3000 --env-file .env.local cocinacore
```

### Future VPS checklist

Use this path when the production VPS is ready:

1. Point DNS to the VPS and configure TLS with a reverse proxy such as Caddy, Traefik, or Nginx.
2. Store production secrets on the server or provider secret store; never bake them into the Docker image.
3. Build and run the app container with `NODE_ENV=production`, Supabase public env vars, server-only AI keys, Sentry env vars, and `REDIS_URL`.
4. Use a managed Supabase project for production unless you intentionally choose to operate Postgres/Supabase yourself.
5. Add a health check against `/api/health` for dashboards, and add a stricter readiness check before using it for load balancer removal decisions.
6. Enable automated backups/snapshots and define a rollback process before the first real customer.
7. Wire `.github/workflows/deploy.yml` to the chosen VPS deployment mechanism only after SSH host, user, key, registry, and rollback strategy are known.

### Platform owner bootstrap

Security hardening quarantines all existing `platform_owners` rows until a database administrator reviews them. After confirming the correct owner user id in Supabase, approve it from a privileged database session:

```sql
select public.approve_platform_owner('<user-id>'::uuid);
```

Do not expose this as an application action. It is intentionally not granted to `authenticated` or `anon` roles.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Client    │────▶│  Next.js    │────▶│   Supabase      │
│  (Browser)  │     │  (Vercel)   │     │  (PostgreSQL)  │
└─────────────┘     └──────┬──────┘     └─────────────────┘
                           │
                    ┌──────┴──────┐
                    │    Redis     │
                    │   (Upstash)  │
                    └──────────────┘
```

## Tenant security guarantees
- Shared database model with strict RLS and required `tenant_id` scoping on tenant-owned data.
- Deny-by-default posture: RLS-enabled tables allow access only through explicit policies.
- Platform Owner/global scope is separated from tenant roles and tenant memberships.
- Tenant role model is `owner | admin | member`, enforced with typed tenant context contracts.
- Runtime RLS evidence must be maintained in `supabase/tests/rls_tenant_isolation.sql` with explicit same-tenant allow and cross-tenant deny expectations.
