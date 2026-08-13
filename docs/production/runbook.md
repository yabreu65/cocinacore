# CocinaCore Production Runbook

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

## First platform owner

After database setup, bootstrap the first platform owner once:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app \
  node scripts/bootstrap-owner.js owner@example.com "Owner Name" "TemporaryStrongPassword123!"
```

## Backups

Daily cron example:

```cron
15 3 * * * cd /opt/cocinacore && . ./.env.production && scripts/postgres-backup.sh
```

Retention defaults to 30 days. Test restoration before activation:

```bash
scripts/postgres-restore.sh backups/cocinacore-YYYYMMDDTHHMMSSZ.dump
```

Redis is cache/queue state, not canonical data.

## Release checklist

- HTTPS and health checks pass.
- Normal application secrets are present and not placeholders.
- The latest CI, PostgreSQL boundary test, and backup restore test passed.
- The separated gate state is intentional and recorded.
- If enabled, the explicit bootstrap attestation preceded restricted migration verification.
- The app render contains neither migration nor bootstrap secrets.
