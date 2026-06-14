# CocinaCore 🍳

SaaS multitenant de recetas asistido por IA.

## Stack
- **Framework:** Next.js (App Router) en `frontend/`
- **Database:** PostgreSQL directo vía `pg` + `pgvector`
- **Cache / queues:** Redis
- **AI:** Gemini como proveedor principal
- **Storage:** driver local hoy, con camino futuro a S3 / Object Storage

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
El workflow `.github/workflows/deploy.yml` hoy solo valida builds de staging/production. El deploy real sigue intencionalmente desacoplado hasta cerrar la infraestructura objetivo.

### Secrets esperados
- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_SECRET`
- `GEMINI_API_KEY` (o dejar Gemini deshabilitado donde la ruta lo soporte)
- `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` según el flujo que termines usando

### Hosting options
**Vercel:**
1. Conectar repo a Vercel
2. Configurar variables de entorno
3. Deploy automático en push a main

**Docker / Self-hosted:**
```bash
docker build -t cocinacore .
docker run -p 3000:3000 --env-file frontend/.env.local cocinacore
```

### VPS checklist
1. Configurar DNS + TLS con Caddy, Traefik o Nginx
2. Guardar secretos fuera de la imagen
3. Ejecutar contenedor con `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, configuración AI y storage
4. Usar tu infraestructura PostgreSQL/Redis gestionada (`pawtech-postgres`, `pawtech-redis`, etc.)
5. Exponer `/api/health` para health checks básicos
6. Definir backups y rollback antes del primer deploy serio
7. Recién ahí conectar `deploy.yml` al mecanismo real de publicación

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
