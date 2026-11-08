# CocinaCore Production Runbook

## Active runtime: Pawtech M1

This is the authoritative Pawtech production path. Read [Production Reality First](production-reality-first.md)
for the mandatory `DISCOVER → DEMONSTRATE → COMPARE → DESIGN → TEST → REHEARSAL → APPROVE →
DEPLOY → VERIFY` sequence and PM approval checkpoint. The [M1 Production Closure Record](m1-production-closure.md)
summarizes dated production evidence and outstanding approval/traceability items; it is not an
operational procedure. The standalone `docker-compose.prod.yml` is a reference only and is **not** the
Pawtech live topology.

- App: `cocinacore-web`, built from the manually selected exact release SHA.
- App directory: `/opt/pawtech/apps/cocinacore`; runtime environment:
  `/opt/pawtech/env/cocinacore.env` (mode `0600`, outside Git).
- PostgreSQL: `pawtech-postgres`, database `cocinacore_db`, runtime user `cocinacore_user`.
- Redis: `pawtech-redis:6379`; networks `pawtech_internal` and `pawtech_public`; routing by
  existing Pawtech Traefik.
- Local uploads bind: `/opt/pawtech/data/cocinacore/uploads:/app/uploads`; `STORAGE_DRIVER=local`
  is supported and requires this directory to exist.
- Email is optional; absent or partial `RESEND_API_KEY` / `EMAIL_FROM` does not block M1. Legacy
  session duration remains 30 days. Separated database lanes remain disabled for the application.
- Secrets stay on the VPS. Application deployment does not use migration credentials or run a
  provisioner. M5 schema migrations use the separate manual workflow and VPS-local migration
  identity described below; they are never injected into the app container.

## M5 schema migration: 018 → 019

This is a separate, explicitly dispatched production operation; it is not part of ordinary app
deployment. It must run from `main` against an exact SHA already integrated there. The only allowed
pending set is the ordered pair `018_cooking_sessions.sql,019_real_consumption_reconciliation.sql`
from a verified 017 baseline. Migration 020 is out of scope.

Before dispatch, the operator must confirm the previously rehearsed restore/acceptance evidence,
review the fresh scheduled backup, and separately obtain owner authorization for the exact SHA and
018/019 operation. The workflow's `approval_reference` is only an operator receipt bound to that
SHA; it is not proof of identity and does not replace any required reviewer configured on the
GitHub `production` Environment. Do not dispatch while those approvals or the environment gate are
uncertain.

The migration runner requires the dedicated VPS file
`/opt/pawtech/env/cocinacore.migration.env`, a regular non-symlink file with mode `0600` containing
only `MIGRATION_DATABASE_URL=...`. Its URL must connect as the non-superuser `migration_admin` to
`cocinacore_db` through `pawtech-postgres`. This identity and
`cocinacore_schema_owner` must already have been provisioned by the separately reviewed procedure;
the workflow does not create roles or credentials. The application keeps using
`/opt/pawtech/env/cocinacore.env` as `cocinacore_user`.

The migration procedure then:

1. Takes the existing shared deploy/migration lock and verifies the pinned CocinaCore path,
   candidate image/source SHA, runtime database identity and health-safe preconditions.
2. Uses the runtime identity only for read-only checks, and separately verifies the migration
   identity is `migration_admin`, non-superuser, non-BYPASSRLS, and connected to the expected DB.
3. Runs the canonical runner's read-only dry-run with the exact 018/019 pending set, verifies the
   existing scheduled backup, applies only those migrations through `MIGRATION_DATABASE_URL`, and
   runs `--verify-complete` through the same dedicated migration lane.
4. Checks the resulting table privileges via the runtime connection: `cooking_sessions` gets
   SELECT/INSERT/UPDATE; session events and the five reconciliation audit tables get SELECT/INSERT;
   runtime UPDATE/DELETE on the append-only tables are denied. It records only secretless evidence.

Do not deploy the M5 application until the workflow reports the complete 019 ledger and runtime ACL
verification. If 018 commits but 019 or a post-migration check fails, stop and preserve evidence;
there is no automatic database rollback. Do not manually delete migration rows or run 020. Use the
separately approved recovery plan and restore rehearsal before any corrective database action. A
subsequent application deployment remains a separate exact-SHA operation with ordinary health and
application-only rollback controls.

## Controlled release sequence

Before any future deployment, the GitHub `production` Environment secret
`VPS_SSH_KNOWN_HOSTS` must be populated with the VPS host key entry obtained from an independently
trusted public host-key source. The workflow fails closed if the secret is empty or does not contain
`VPS_HOST`, and both deploy and rollback require strict SSH host-key checking. Do not establish trust
with `ssh-keyscan`; no host-key value is documented here. GitHub configuration is not changed by
this runbook or this hardening change.

1. A human manually selects the exact 40-hex SHA already integrated into `origin/main`. GitHub
   validates the SHA, confirms ancestry, checks out the exact commit, and runs Node `22.22.3`,
   `npm ci`, lint, `test:coverage`, typecheck, build, maintained static contracts, and the daily
   backup verification scenario before configuring SSH. The manual workflow uses the `production`
   environment and serialized `deploy-production` concurrency with cancellation disabled; it has no
   automatic retry.
2. SSH uses the pinned `/opt/pawtech/apps/cocinacore` path and validates its canonical realpath.
   The VPS receives the exact release SHA and production URL; it explicitly runs read-only preflight
   before deploy mode. Preflight validates the absolute URL, runtime env path/mode/expected target,
   shared networks and service health, uploads directory, source ancestry, and required tools/helper.
   It creates no files and returns before deploy lock, trap, or mutations.
3. Deploy uses `git archive "$RELEASE_SHA"` as the sole release source, excluding untracked VPS
   files, and builds that exact-SHA image.
4. Before migration-state verification, deploy invokes the strict read-only daily Object Storage
   verifier. It checks only the existing scheduled `cocinacore_db` backup, streams its sidecar and
   dump for checksum/archive checks, and requires archive markers proving migrations 016/017. It
   rejects missing, stale, corrupt, unreadable, or pre-016/017 artifacts and checks the scheduled
   role's `BYPASSRLS` metadata without querying application tables. Deploy never creates a predeploy
   backup; there is no `pg_dump`, copy/upload, local dump/sidecar, or database restore in this path.
   The known 19-Oct artifact lacks 016/017 markers and is rejected; it is not claimed to cover
   FORCE RLS. A future post-migration artifact must pass the markers before any FORCE RLS coverage
   claim is made.
5. Only `npm run db:migrate:verify` runs, after scheduled-backup verification. It is read-only and
   requires the existing migration ledger to be complete and ordered. M1 requires
   `MIGRATION_EXPECTATION=NO_OP` and `DATABASE_CHANGED=NO`; pending migrations fail closed. No
   provisioning, mutating migration, DDL, or automatic database restore is allowed. Never run `pg_restore --clean` or restore automatically.
6. A candidate runs on `pawtech_internal` only. App, database, and Redis health must pass before
   application cutover. Before cutover, deploy writes a mode-`0600` non-secret state record in the
   existing CocinaCore state directory, binding release SHA, image, previous container/id/image, the
   fixed `DAILY_BACKUP_VERIFIED` token, `DATABASE_CHANGED=NO`, and the deterministic attempt ID. No
   backup artifact path is stored.
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
- Exact-SHA archive build completes; deploy validates the existing scheduled Object Storage backup only.
- Deploy creates no predeploy backup. The existing artifact passes freshness, checksum, archive,
  016/017, and scheduled-role RLS compatibility checks. Pre-016/017 artifacts, including the known
  19-Oct artifact, are rejected and are not represented as FORCE RLS coverage.
- Read-only migration verification passes with `MIGRATION_EXPECTATION=NO_OP` and
  `DATABASE_CHANGED=NO`.
- Internal-only candidate passes app/database/Redis health before cutover.
- Internal/public health and independent GitHub public smoke pass; rollback evidence is retained.
