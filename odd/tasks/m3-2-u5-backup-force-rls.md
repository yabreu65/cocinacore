# M3.2 U5 — FORCE RLS-safe predeploy backup

## Goal
Correct the CocinaCore predeploy backup after deploy run `39294151698` failed because `pg_dump` used the application role against `FORCE ROW LEVEL SECURITY` recipe tables. Preserve RLS, app privileges, shared projects, existing backups, and production data.

## Scope
- Investigate the scheduled `pawtech-postgres-backup.timer` role without printing secrets.
- Use the verified backup operator for the single CocinaCore database export; do not change production roles or secrets in this PR.
- Add contract and scenario tests covering FORCE RLS and complete archive validation.
- Preserve checksum, `pg_restore --list`, mode 600/700, rollback/no-database-change, and shared-project isolation controls.
- Deliver through one approved issue, one controlled PR, and official CI only.
- No production deploy retry or role provisioning in this change.

## Tasks
- [x] Read the deploy failure and existing backup helper/contracts.
- [x] Inspect the scheduled timer role and PostgreSQL role metadata read-only.
- [x] Create and approve a dedicated issue under repository policy (#34, `type:bug`, `status:approved`).
- [x] Implement the minimal helper correction without disabling RLS or widening app access.
- [x] Add FORCE RLS/full-export scenario and contract tests.
- [ ] Verify checks; commit one work unit and open the controlled PR (outside this implementation task).
- [ ] Monitor CI; stop before any production role/deploy action.

## Findings
- Deploy run `39294151698` failed before app cutover because the helper invoked `pg_dump -U cocinacore_user`; after migrations 016/017, `public.user_recipe_versions` is FORCE RLS and the app role lacks BYPASSRLS.
- The scheduled `pawtech-postgres-backup.timer` runs `/opt/pawtech/backups/scripts/backup-postgres.sh` as `yoryi`, sources an environment file, and uses `POSTGRES_USER`.
- Identity-bound read-only inspection selected `pawtech-postgres` on `pawtech_internal`: scheduled role `pawtech_root`; PostgreSQL metadata shows `pawtech_root` is superuser/BYPASSRLS, while `cocinacore_user` is neither. No passwords or env contents were read.
- A dedicated non-superuser backup role with BYPASSRLS and read-only grants may be a future least-privilege hardening, but provisioning it requires a separate authorized production role/secret change. This PR must not perform that mutation.
- Minimal safe correction for the current verified topology: use the existing scheduled backup operator `pawtech_root` for the backup helper, keep the app role unchanged, never disable RLS/FORCE RLS, and retain full archive validation.

## Evidence
- Failed deploy: `39294151698`.
- Successful migrations 016/017: `39293413831`.
- Main SHA: `06eccd942efbfadacb8f4e7656d792f135099a18`.

## Implementation and test status
- The predeploy helper now invokes `pg_dump` as verified scheduled operator `pawtech_root`, preserving the fixed CocinaCore database/container and all existing artifact/integrity safeguards.
- A fake-Docker FORCE RLS scenario asserts the verified role, complete nonempty export, stdin archive listing, and CocinaCore-only resource use. The scenario is included in CI's static-contract section; existing rollback and unchanged-database contracts remain in place.
- Focused validation is recorded in the implementation handoff. No commit identity is claimed.

## Commit evidence
- Not committed by this implementation.
