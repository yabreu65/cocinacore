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

## Runtime boundary

CocinaCore runs on one VPS with a dedicated PostgreSQL database and Redis on the private Compose
network. The long-running app listens on `127.0.0.1:3000`, uses S3-compatible object storage, and
never receives bootstrap or migration credentials.

PR0A separates three database actors:

- the existing PostgreSQL administrator is an exceptional, operator-invoked bootstrap actor;
- `migration_admin` is a restricted login that can only assume `cocinacore_schema_owner`;
- `cocinacore_schema_owner` is a non-login owner for ordinary CocinaCore database objects.

Merging this code is **not** activation. The separated lane is disabled by default and an ordinary
deploy keeps the legacy migration behavior until the activation ceremony is approved.

## Server configuration

Create `.env.production` next to `docker-compose.prod.yml`; never commit it. Use mode `0600`.
At minimum it contains the normal application and infrastructure configuration:

```bash
chmod 600 .env.production
COCINACORE_SEPARATED_DB_LANES_ENABLED=false
POSTGRES_DB=cocinacore
POSTGRES_USER=cocinacore
POSTGRES_PASSWORD=<secret>
APP_PORT=3000
APP_PUBLIC_URL=https://your-domain.example
AUTH_SECRET=<secret>
GEMINI_API_KEY=<secret>
RESEND_API_KEY=<secret>
EMAIL_FROM="CocinaCore <no-reply@your-domain.example>"
S3_ENDPOINT=https://s3-compatible-endpoint.example
S3_REGION=auto
S3_BUCKET=cocinacore-production
S3_ACCESS_KEY_ID=<secret>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=true
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

The gate accepts explicit true values (`true`, `1`, `yes`, `on`) and explicit false values
(`false`, `0`, `no`, `off`). Missing means disabled; any other value fails configuration validation.

For the one-time activation ceremony, create a separate root-readable `.env.migration`:

```bash
chmod 600 .env.migration
BOOTSTRAP_DATABASE_URL=postgresql://<existing-admin>:<secret>@postgres:5432/cocinacore
MIGRATION_DATABASE_URL=postgresql://migration_admin:<different-secret>@postgres:5432/cocinacore
MIGRATION_ADMIN_PASSWORD=<same-migration-admin-secret>
```

`BOOTSTRAP_DATABASE_URL` and `MIGRATION_ADMIN_PASSWORD` are projected only into the one-shot
`provisioner`. `MIGRATION_DATABASE_URL` is projected only into the one-shot `migrator`. Neither
operations service loads an env file, and the app environment is explicitly allowlisted rather
than inheriting `.env.migration`.

For local operations, the same variables may be placed in private `frontend/.env.local`.
`frontend/.env.example` remains the application/local runtime contract. The migration runner never
falls back from `MIGRATION_DATABASE_URL` to `DATABASE_URL` while separated mode is enabled.

## Trusted baseline and extension boundary

`db/migrations/manifest.json` is the versioned root of trust for historical migrations 001–010,
the exact legacy catalog, the 38 ownership-transfer targets, roles, lock, and extensions. It is not
generated or rewritten during deployment.

The PostgreSQL server must expose the extensions declared in the manifest. Production and CI use
`pgvector/pgvector:pg16`. The reviewed local digest is an arm64 platform manifest, so it is not a safe
pin for the amd64 CI runner or an unconfirmed VPS architecture. Resolving and approving a
platform-specific or multi-architecture digest remains an activation prerequisite and a documented
reproducibility risk; this PR does not perform network resolution to invent one. Node, npm, the app,
and deploy scripts never install OS packages or download extension binaries.

- `vector` is the only bootstrap-managed extension. On a fresh pre-001 database the explicit
  provisioner installs it in `public` when available and absent. On an established database it is
  attestation-only. It is never dropped, relocated, or automatically updated.
- `pgcrypto` remains owned by historical migration 001. In a fresh separated install it is created
  by `cocinacore_schema_owner`; a trusted legacy administrative owner is also accepted.
- `plpgsql` must already exist in `pg_catalog` and is attested only.

Extension-managed objects never enter the application ownership allowlist. Every extension and DB
mutation uses the shared session advisory-lock namespace
`cocinacore:database-change:v1:<database>`.

## Merge-safe deployment (default)

With the gate missing or false, no migration or bootstrap secret is required. The deployment runs
the legacy migration command through the app container and does not invoke the provisioner.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build app
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app npm run db:migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
```

## Explicit activation ceremony

Do not perform this ceremony merely because PR0A was merged. Schedule and approve it separately:

1. Take and verify a database backup.
2. Perform the read-only ledger/catalog attestation against the trusted manifest.
3. Install `.env.migration` with mode `0600` and verify the target database identities.
4. While the production gate is still disabled, invoke the explicit provisioner once:

   ```bash
   COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
   docker compose -f docker-compose.prod.yml \
     --env-file .env.production --env-file .env.migration \
     --profile operations run --rm provisioner npm run db:provision
   ```

5. Verify roles, extensions, owners, ACLs, legacy reads/writes, and persistent data.
6. Set `COCINACORE_SEPARATED_DB_LANES_ENABLED=true` in `.env.production`.
7. Run the restricted migration lane and completeness verification:

   ```bash
   docker compose -f docker-compose.prod.yml \
     --env-file .env.production --env-file .env.migration \
     --profile operations run --rm migrator npm run db:migrate
   docker compose -f docker-compose.prod.yml \
     --env-file .env.production --env-file .env.migration \
     --profile operations run --rm migrator npm run db:migrate:verify
   ```

8. Start the app and perform the approved health and acceptance checks.

Bootstrap is never part of app startup or an ordinary deploy. A failed bootstrap prevents migration
from starting. Stable operational identifiers include `VECTOR_NOT_AVAILABLE`,
`VECTOR_STATE_MISMATCH`, `BASELINE_MISMATCH`, `ROLE_STATE_MISMATCH`, `LOCK_TIMEOUT`,
`MIGRATION_IDENTITY_MISMATCH`, and `MIGRATION_CHECKSUM_MISMATCH`; reports must not include URLs or
passwords.

## Reprovisioning

An exact second provision is an attestation/no-op except for intentional external rotation of the
`migration_admin` password. Missing roles are created only when both are absent. Partial roles,
attribute/membership/config/ACL/ownership drift, catalog drift, or an established missing extension
fails before persistent mutation.

## Rollback

Before any activation database mutation, leave or return the gate to disabled and keep the legacy
path. After ownership or ledger mutation, do **not** delete roles, rewrite trusted history, reinstall
extensions, or blindly run an old runner. Preserve the database and new DB tooling. Roll back only
the app image when backward compatibility was proven, then diagnose and forward-fix. A full catalog
rollback requires the preactivation backup and a separately approved restore procedure.

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
