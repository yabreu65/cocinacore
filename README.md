# CocinaCore 🍳

SaaS multitenant de recetas asistido por IA.

## Stack
- **Framework:** Next.js (App Router) en `frontend/`
- **Database:** PostgreSQL directo vía `pg` + `pgvector`
- **Cache / queues:** Redis
- **AI:** Gemini como proveedor principal
- **Storage:** local en desarrollo; S3-compatible en producción

## Repository structure
- `frontend/` — aplicación Next.js
- `db/migrations/` — migraciones PostgreSQL directas usadas por el runtime actual

## Engineering gates
Antes de considerar un cambio merge-ready, corré desde la raíz del repo:

```bash
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm test
cd frontend && npm run build
```

Si falla cualquiera, el cambio NO está listo.

## Type safety standard
No uses `any` en código de aplicación ni en trust boundaries. Preferí:

- `unknown` para datos externos hasta validarlos
- guards o schemas para entrada no confiable
- DTOs explícitos para contratos API/domain
- repositorios y tipos de filas DB explícitos

## Secret handling
Los secretos deben quedarse server-side. No expongas `DATABASE_URL`, `AUTH_SECRET`, `GEMINI_API_KEY` ni credenciales similares por `NEXT_PUBLIC_*` ni en bundles cliente.

## Local development
### Opción recomendada: app local + servicios en Docker

```bash
docker compose -f docker-compose.local.yml up -d
cd frontend && npm ci
cd frontend && npm run db:migrate
cd frontend && npm run dev
```

Esto deja:
- PostgreSQL en `localhost:5433`
- Redis en `localhost:6379`
- App en [http://localhost:3000](http://localhost:3000)

### Bootstrap del primer owner

```bash
cd frontend && npm run db:bootstrap -- "owner@cocinacore.local" "Owner Local" "ChangeMe123!"
```

El script está diseñado como one-shot: si ya existe platform owner, aborta.

### Opción full Docker

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## Environment variables
La referencia activa es:

```text
frontend/.env.example
```

El archivo `frontend/.env.example.legacy` queda solo como referencia histórica de la migración. No reintroduzcas variables obsoletas de esa etapa al runtime.

## Deployment

Production uses the existing Pawtech shared topology and a manually dispatched, exact-SHA GitHub
workflow. Merging to `main` does not deploy. The release checks source ancestry, runs Node 22.22.3
quality checks and static contracts before SSH, performs read-only preflight, builds from
`git archive` of the selected SHA, validates a CocinaCore-only backup, and runs only read-only
migration verification before application cutover. Runtime secrets stay on the VPS. Email is
optional and missing/partial Resend configuration does not block M1.

The authoritative sequence, topology, evidence and recovery boundaries are documented in
[`docs/production/runbook.md`](docs/production/runbook.md) and
[`docs/production/production-reality-first.md`](docs/production/production-reality-first.md).
`docker-compose.prod.yml` is a standalone reference only and is **not** the Pawtech live topology.


## Architecture

```text
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Client    │────▶│  Next.js    │────▶│   PostgreSQL      │
│  (Browser)  │     │   App       │     │  (direct via pg) │
└─────────────┘     └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────┴──────┐
                    │    Redis     │
                    │ rate-limit   │
                    │ + queues     │
                    └──────────────┘
```

## Tenant security guarantees
- Modelo shared-db con `tenant_id` obligatorio en datos tenant-owned
- Auth y autorización resueltas en la aplicación con sesiones, guards y repositorios
- Scope Platform Owner separado de roles tenant
- Roles tenant: `owner | admin | member`
