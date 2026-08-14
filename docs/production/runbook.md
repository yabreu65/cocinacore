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

## Production deploy procedure

Merging to `main` does **not** deploy production. Production deployment is an explicit, controlled
GitHub Actions operation and remains separate from database lane activation.

1. Select the exact full 40-character commit SHA to deploy. The SHA must already be integrated into
   `main`; it may be an earlier `main` ancestor for an explicit application rollback.
2. In GitHub, open **Actions** → **Deploy** → **Run workflow**, keep the `main` workflow ref selected,
   and enter the exact SHA in the required `sha` input.
3. The `validate-deploy` job checks the SHA format, confirms that it resolves to a commit, and verifies
   that it is an ancestor of `origin/main`. Invalid, incomplete, or non-`main` SHAs fail before the
   production environment or its secrets are used.
4. The `production` GitHub Environment is the deployment boundary. Configure any protection rules or
   required reviewers in GitHub Environment settings; this repository does not claim they are enabled.
5. The deploy job checks out that exact validated SHA. On the VPS, tracked changes in the deployment
   repository abort the release. The build source is then generated from a Git archive of that SHA, so
   untracked and ignored VPS files cannot enter the application image or migration source.
6. Runtime configuration remains external in `.env.production`; it is used by Docker Compose but is not
   part of the archived Docker build context. Local VPS edits must never silently enter a release.
7. Verify the production health/smoke check and perform the approved acceptance checks after deployment.

`MERGE != DB LANE ACTIVATION`. Any separated database lane activation follows its own explicit,
approved ceremony; running a production deploy does not change its configuration.

## Historical SHA compatibility gate

Deploying the current or a new SHA from `main` follows the normal production deploy procedure above.
Deploying a historical SHA from `main` is an **application/code redeploy**, not a database rollback.

Before running a historical SHA, the maintainer must perform and record an explicit compatibility
assessment between the historical application code and the current production database schema:

1. Identify the historical `DEPLOY_SHA`, the current production application SHA, and the current applied
   database migration state.
2. Review every migration applied after the selected SHA and determine whether it introduced an
   incompatibility for the historical code, including removed or renamed columns/tables, incompatible
   constraints, changed or removed enum values, type changes, database contract/API changes, or permission
   and role changes the historical code does not support.
3. Record `DEPLOY_SHA`, `CURRENT_PRODUCTION_SHA`, `CURRENT_DB_MIGRATION_STATE`,
   `COMPATIBILITY_VERDICT`, `EVIDENCE/NOTES`, and `APPROVED_BY` in the operational release record.
4. Continue with the application/code redeploy only when the verdict is `COMPATIBLE`. A verdict of
   `NOT COMPATIBLE` or `UNKNOWN` blocks the historical application deploy.

Normal deployment migrations are forward-only. Selecting an older SHA does not revert already-applied
database migrations. If the required recovery also needs to move the database schema or data backward,
use the approved backup/restore or disaster-recovery procedure; do not assume this deploy workflow performs
database rollback. See the backup and rollback guidance in this runbook.

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

An application rollback does not roll back database migrations. If a migration is not backward-compatible,
restore the database backup before starting the app.

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
