# CocinaCore Production Runbook

## Active runtime: Pawtech M1

This is the authoritative Pawtech production path. Read [Production Reality First](production-reality-first.md)
for the mandatory `DISCOVER → DEMONSTRATE → COMPARE → DESIGN → TEST → REHEARSAL → APPROVE →
DEPLOY → VERIFY` sequence and PM approval checkpoint. The standalone `docker-compose.prod.yml` is a
reference only and is **not** the Pawtech live topology.

- App: `cocinacore-web`, built from the manually selected exact release SHA.
- App directory: `/opt/pawtech/apps/cocinacore`; runtime environment:
  `/opt/pawtech/env/cocinacore.env` (mode `0600`, outside Git).
- PostgreSQL: `pawtech-postgres`, database `cocinacore_db`, runtime user `cocinacore_user`.
- Redis: `pawtech-redis:6379`; networks `pawtech_internal` and `pawtech_public`; routing by
  existing Pawtech Traefik.
- Local uploads bind: `/opt/pawtech/data/cocinacore/uploads:/app/uploads`; `STORAGE_DRIVER=local`
  is supported and requires this directory to exist.
- Email is optional; absent or partial `RESEND_API_KEY` / `EMAIL_FROM` does not block M1. Legacy
  session duration remains 30 days. Separated database lanes remain disabled.
- Secrets stay on the VPS. No `.env.production`, `.env.migration`, `migration_admin`,
  `db:provision`, standalone Compose deployment, or shared infrastructure creation/mutation is part
  of this release path.

## Controlled release sequence

Before any future deployment, the GitHub `production` Environment secret
`VPS_SSH_KNOWN_HOSTS` must be populated with the VPS host key entry obtained from an independently
trusted public host-key source. The workflow fails closed if the secret is empty or does not contain
`VPS_HOST`, and both deploy and rollback require strict SSH host-key checking. Do not establish trust
with `ssh-keyscan`; no host-key value is documented here. GitHub configuration is not changed by
this runbook or this hardening change.

1. A human manually selects the exact 40-hex SHA already integrated into `origin/main`. GitHub
   validates the SHA, confirms ancestry, checks out the exact commit, and runs Node `22.22.3`,
   `npm ci`, lint, `test:coverage`, typecheck, build, and all four maintained static contracts
   before configuring SSH. The manual workflow uses the `production` environment and serialized
   `deploy-production` concurrency with cancellation disabled; it has no automatic retry.
2. SSH uses the pinned `/opt/pawtech/apps/cocinacore` path and validates its canonical realpath.
   The VPS receives the exact release SHA and production URL; it explicitly runs read-only preflight
   before deploy mode. Preflight validates the absolute URL, runtime env path/mode/expected target,
   shared networks and service health, uploads directory, source ancestry, and required tools/helper.
   It creates no files and returns before deploy lock, trap, or mutations.
3. Deploy uses `git archive "$RELEASE_SHA"` as the sole release source, excluding untracked VPS
   files, and builds that exact-SHA image before backup.
4. The extracted release's versioned `scripts/backup-pawtech-cocinacore-predeploy.sh` handles only
   `cocinacore_db` on `pawtech-postgres`. It requires the pre-existing
   `/opt/pawtech/backups/postgres/cocinacore_db/manual` hierarchy and creates a unique private
   timestamp/SHA run directory. It produces a custom `pg_dump -Fc --no-owner --no-acl`, private
   SHA-256 sidecar, verifies the checksum, and validates the archive with `pg_restore --list` in the
   PostgreSQL container. Deploy verifies artifact/sidecar ownership and modes, directory mode,
   checksum, and helper success before migration verification or candidate startup. Any failure
   stops deployment and leaves artifacts in place. The shared multi-database backup routine,
   retention, offsite transfer, and restore are never invoked by this helper.
5. Only `npm run db:migrate:verify` runs, after backup integrity validation. It is read-only and
   requires the existing migration ledger to be complete and ordered. M1 requires
   `MIGRATION_EXPECTATION=NO_OP` and `DATABASE_CHANGED=NO`; pending migrations fail closed. No
   provisioning, mutating migration, DDL, or automatic database restore is allowed. Never run `pg_restore --clean` or restore automatically.
6. A candidate runs on `pawtech_internal` only. App, database, and Redis health must pass before
   application cutover. Before cutover, the deploy writes a mode-`0600` non-secret state record in
   the private CocinaCore backup run directory, binding release SHA, image, previous container/id/
   image, backup artifact, `DATABASE_CHANGED=NO`, and the deterministic GitHub attempt ID. The
   record and backup evidence are preserved.
7. The new app is connected to the existing public network and must pass internal and public health.
   Public health requires successful HTTP and JSON app/database/Redis health. The remote script then
   reports `REMOTE_DEPLOY_READY`, not final deployment success. GitHub performs an independent
   second `/api/health` HTTP+JSON smoke check; the workflow is successful only if it passes.
8. If remote cutover health fails, the deploy script's guarded application rollback runs. If the
   second public health smoke fails after remote deploy succeeded, a failure-only GitHub continuation
   invokes the exact release script's rollback mode with the same attempt ID. Rollback locates exactly
   one matching state record, validates its owner/mode/path/content and the retained previous
   container identity, removes only the app proven to match this attempt/image (or accepts it absent),
   restores and starts the prior app, then proves its identity, running state, exact two-network
   membership, and internal/public app/database/Redis health. Success reports `APP_ROLLBACK_SAFE`;
   uncertainty or mutation/proof failure reports `MANUAL_INTERVENTION_REQUIRED`. A successful
   recovery does not turn the failed smoke or workflow green. Recovery never builds, backs up,
   migrates, or restores a database.

## Recovery boundaries and operational evidence

An application rollback does not reverse a database change. M1 must keep `DATABASE_CHANGED=NO`;
any unexpected database state stops automatic recovery and requires an explicit human decision. A
backup artifact and checksum are not proof of restorability: restore drills belong to a separately
authorized future step and approved environment. Preserve existing shared services and tenant
boundaries. Do not treat production as a lab or infer destructive authority from access.

For a historical SHA redeploy, separately record and review compatibility with the current database
schema before approval. Runtime migrations are forward-only; older application source does not roll
the database backward. Never print credentials, copy runtime env into the repository, or improvise
restore commands.

The PostgreSQL extension image policy is `pgvector/pgvector:pg16`. The reviewed digest is an
arm64 platform manifest, so it is not asserted as a safe pin for amd64 CI or an unconfirmed VPS
architecture. Resolving a platform-specific or multi-architecture digest is a separate approved
reproducibility task.

## Release checklist

- The PM has populated the GitHub `production` Environment secret `VPS_SSH_KNOWN_HOSTS` from an
  independently trusted public host-key source; the value is never stored in this runbook.
- Exact full SHA is integrated into `origin/main`, manually selected, and approved at the PM
  checkpoint.
- Required frontend quality checks and all four static contracts pass before SSH setup.
- Preflight confirms the known Pawtech runtime and exits before deploy mutations.
- Exact-SHA archive build completes before the CocinaCore-only backup.
- Backup artifact and sidecar pass mode, ownership, checksum, and archive validation.
- Read-only migration verification passes with `MIGRATION_EXPECTATION=NO_OP` and
  `DATABASE_CHANGED=NO`.
- Internal-only candidate passes app/database/Redis health before cutover.
- Internal/public health and independent GitHub public smoke pass; rollback evidence is retained.
