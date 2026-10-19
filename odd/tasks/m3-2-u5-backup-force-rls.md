# M3.2 U5 — Read-only daily backup verification

## Goal
Replace the deploy-generated predeploy `pg_dump` after deploy run `39294151698` failed against `FORCE ROW LEVEL SECURITY`. Validate only the existing scheduled Object Storage backup for `cocinacore_db`; never generate, copy, upload, restore, or accept a pre-migration artifact.

## Scope
- Investigate `pawtech-postgres-backup.timer` and its Object Storage artifact without printing secrets.
- Remove the deploy/workflow predeploy backup path completely.
- Add a strict read-only verifier for freshness, checksum, archive readability, 016/017 coverage, and scheduled-job FORCE RLS compatibility.
- Fail closed when the daily backup is absent, stale, corrupt, unreadable, pre-migration, or RLS-incompatible.
- Preserve application rollback/no-database-change controls and shared-project isolation.
- Deliver the controlled revision through PR #35 and official CI only.
- No production retry, role provisioning, extra backup, copy, migration, deploy, or smoke action.

## Tasks
- [x] Read the deploy failure and existing backup helper/contracts.
- [x] Inspect the scheduled timer, Object Storage namespace, newest artifact metadata, and RLS role read-only.
- [x] Create and approve issue #34 under repository policy (`type:bug`, `status:approved`).
- [x] Replace generated predeploy backup with strict read-only daily-backup verification.
- [x] Add deterministic valid/absent/stale/corrupt/unreadable/pre-migration/RLS-incompatible and secret-leak tests.
- [x] Run focused verification; no production deploy, retry, smoke, role, secret, or backup action occurred.
- [x] Stop at GO=NO until a new owner-approved post-migration backup is present.

## Findings
- Deploy run `39294151698` failed before app cutover because the generated helper invoked `pg_dump -U cocinacore_user`; after migrations 016/017, `public.user_recipe_versions` is FORCE RLS and the app role lacks BYPASSRLS.
- The scheduled timer is enabled, last triggered `2026-10-19 10:19:15 CEST`, and its service result was `success`; it runs `/opt/pawtech/backups/scripts/backup-postgres.sh` as `yoryi`.
- The existing Object Storage namespace contains 34 dumps and 34 sidecars. The newest is 120982 bytes at `2026-10-19 10:19:34`; its sidecar exists and `pg_restore --list` is readable, but checksum verification was unavailable and required 016/017 archive markers were absent.
- Therefore `POST_MIGRATION_ACCEPTABLE=NO` and `GO=NO`. The 19-Oct artifact predates migrations and is not claimed to cover FORCE RLS.
- Prior identity-bound role evidence found the scheduled job uses `pawtech_root` with superuser/BYPASSRLS, while `cocinacore_user` is neither. This indicates the job command is RLS-compatible for a future post-migration artifact, but does not validate the current pre-migration artifact.
- A dedicated non-superuser BYPASSRLS role remains future separately authorized work. This revision must not provision roles, change secrets, or run the backup job.

## Evidence
- Failed deploy: `39294151698`.
- Successful migrations 016/017: `39293413831`.
- Main SHA: `06eccd942efbfadacb8f4e7656d792f135099a18`.
- Existing daily artifact read-only result: checksum `UNAVAILABLE`, archive readable, 016/017 coverage `FAIL`, post-migration `NO`, overall `GO=NO`.

## Implementation and test status
- Deploy and migration no longer invoke the generated predeploy dump helper; both require the read-only scheduled Object Storage verifier before mutation and store only fixed verification evidence.
- Local deterministic scenario covers valid, absent, stale, corrupt checksum, unreadable archive, missing 016/017, RLS-incompatible role, secret-free output, CocinaCore namespace/container/database isolation, and forbidden dump/copy/restore behavior.
- Local evidence is read-only and GO=NO: the observed 19-Oct artifact lacks checksum proof and 016/017 markers. All focused shell checks, shellcheck error-level checks, and the existing frontend quality suite passed; the M1 rehearsal hash was updated for the intentional deploy-path change. No production retry, backup, copy, migration, deploy, smoke, role change, or secret change has occurred.

## Commit evidence
- Redesign implementation: `232f9f8` (`fix(ops): verify scheduled backup without generating predeploy dump`).
- Prior task-record commit: `4cf348d` (`docs(odd): record FORCE RLS backup delivery`).
- PR: #35 (`https://github.com/yabreu65/cocinacore/pull/35`), linked to approved issue #34.
- Final CI run `39329867793` passed `frontend-quality` and `E2E Tests` for head `fb034ed`.
