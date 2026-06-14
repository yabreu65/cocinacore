# CocinaCore Production Runbook

## Target runtime

- Single VPS running Docker Compose.
- PostgreSQL and Redis run on the VPS private Docker network.
- The app listens on `127.0.0.1:3000`; terminate HTTPS with Caddy, Nginx, or Traefik.
- PDFs/uploads use S3-compatible storage via `STORAGE_DRIVER=s3`.
- Transactional email uses Resend.

## Required server files

Create `.env.production` on the VPS next to `docker-compose.prod.yml`. Never commit it.

Required values:

```bash
POSTGRES_DB=cocinacore
POSTGRES_USER=cocinacore
POSTGRES_PASSWORD=change-me
APP_PORT=3000
APP_PUBLIC_URL=https://your-domain.example
AUTH_SECRET=change-me-long-random-secret
GEMINI_API_KEY=change-me
RESEND_API_KEY=change-me
EMAIL_FROM=CocinaCore <no-reply@your-domain.example>
S3_ENDPOINT=https://s3-compatible-endpoint.example
S3_REGION=auto
S3_BUCKET=cocinacore-production
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
S3_FORCE_PATH_STYLE=true
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

## First deploy

```bash
git fetch --all --prune
git checkout <release-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production build app
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app npm run db:migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
curl -fsS https://your-domain.example/api/health
```

Bootstrap the first platform owner once only:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app \
  node scripts/bootstrap-owner.js owner@example.com "Owner Name" "TemporaryStrongPassword123!"
```

## Deploy update

```bash
git fetch --all --prune
git checkout <release-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production build app
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app npm run db:migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
curl -fsS https://your-domain.example/api/health
```

## Rollback

```bash
git checkout <previous-release-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production build app
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
curl -fsS https://your-domain.example/api/health
```

If a migration is not backward-compatible, restore the database backup before starting the app.

## Backups

Daily cron example:

```cron
15 3 * * * cd /opt/cocinacore && . ./.env.production && scripts/postgres-backup.sh
```

Retention defaults to 30 days. Test restore before launch:

```bash
scripts/postgres-restore.sh backups/cocinacore-YYYYMMDDTHHMMSSZ.dump
```

Redis is treated as cache/queue state, not canonical data.

## Release checklist

- HTTPS is active and redirects HTTP to HTTPS.
- `AUTH_SECRET` is long, random, and not `CHANGE_ME`.
- `APP_PUBLIC_URL` matches the public HTTPS domain.
- Resend domain is verified and password reset email works.
- S3 bucket write/delete works.
- `npm run db:migrate` has completed successfully.
- `/api/health` returns 200.
- Owner health page works for a platform owner.
- Latest CI passed lint, tests, coverage, typecheck, build, and E2E.
- Latest Postgres backup restore was tested.
