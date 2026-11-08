# M6 020E-B — Backup, restore, and recovery rehearsal

**Decision:** the PostgreSQL 16 disposable rehearsal passed for both the 019 boundary and activated 020. This runbook defines the required operational gates; it does not authorize a persistent database change or production deployment.

## Quick path

1. Confirm the approved release SHA, owner approval, exact migration-020 checksum, and a recent backup with an independent restore receipt.
2. Verify boundary 019 and the exact one-migration pending set with the official restricted runner.
3. Enable signup maintenance and verify the actual HTTP 503/no-write behavior while existing login remains available.
4. Prepare inert capabilities with A1-P, apply 020 with `run-migrations.js`, activate R4 only with the separate authorized admin identity, then require `--verify-complete` and SQL/HTTP acceptance before reopening signup.
5. If any gate fails, keep signup closed. Do not restore legacy INSERTs, disable FORCE RLS, grant broad access, or perform a code-only rollback.

The commands below show the intended order. Supply connection values and provisioning secrets only through the approved secret-injection mechanism; never put them in shell history, command output, checked-in files, or CI logs. This runbook was not executed against Contabo, Supabase, or any persistent database.

## Backup and restore contract

The verified disposable backup consisted of a PostgreSQL custom archive plus a separate global-role export:

```sh
umask 077
pg_dump -Fc -U "$BACKUP_ADMIN_ROLE" -d "$DATABASE_NAME" > "$ARCHIVE_FILE"
pg_dumpall --globals-only -U "$BACKUP_ADMIN_ROLE" > "$GLOBALS_FILE"
chmod 600 "$ARCHIVE_FILE" "$GLOBALS_FILE"
sha256sum "$ARCHIVE_FILE" > "$ARCHIVE_FILE.sha256"
pg_restore --list "$ARCHIVE_FILE" > /dev/null
sha256sum -c "$ARCHIVE_FILE.sha256"
```

`pg_dump` does **not** include cluster roles. The globals export contains role definitions and password verifiers; treat it as credential material, encrypt it at rest, restrict its access, and apply the retention policy separately. The restore rehearsal restored role globals before database objects, then reapplied only the exact `migration_admin -> cocinacore_schema_owner` membership options through the disposable restore administrator because a regular restored grantor cannot recreate that membership. It compared role attributes/settings/comments and memberships, effective ACL entries, object owners, schema/constraints/indexes/functions/triggers/policies, a digest of the complete logical data-only dump, and representative data/relationships. Login credentials were also exercised against the independent restore.

The archive restore runs as an authorized restore administrator. Extension members may be owned by a different superuser after restore; the rehearsal treats this as acceptable only where the official extension contract allows an administrative superuser and `--verify-boundary 019`/`--verify-complete` attest the extension state. Application object owners and effective ACLs are compared separately; superuser grant recipients are normalized as the same administrative class, while application LOGIN and NOLOGIN roles remain exact.

### Existing scripts are not the 020 recovery procedure

| Existing mechanism                                                                     | Finding                                                                                                                                                          | 020 use                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `scripts/postgres-backup.sh`                                                           | Writes only a custom database archive; it does not export global roles, create a checksum sidecar, or prove an independent restore.                              | Not sufficient alone for the 020 backup gate.                                     |
| `scripts/postgres-restore.sh`                                                          | Restores with `--clean --if-exists --no-owner`; it is destructive and does not restore global identities or the reviewed owners.                                 | Do not use for 020 recovery or as an in-place rollback.                           |
| `scripts/migrate-pawtech-production.sh` and `.github/workflows/migrate-production.yml` | Pin U5 migrations 016/017 and their historical approval token, daily-backup check, and pending set.                                                              | Not a 020 workflow; do not dispatch or repurpose as-is.                           |
| `scripts/verify-pawtech-cocinacore-daily-backup.sh`                                    | Read-only freshness/checksum/archive-readability evidence for the scheduled archive and 016/017 entries; it does not restore the archive or verify global roles. | Supporting evidence only; a recent independent restore receipt is still required. |

## Controlled 020 procedure

### 1. Release and backup gate

- Resolve the full release SHA from the approved integrated release and record a separate owner approval reference. The workflow's 016/017 input is a manual receipt, not an enforced review gate and is not approval for 020.
- Verify the release contains the exact reviewed `db/migrations/020_tenant_rls_hardening.sql` and manifest contract. For the currently approved candidate, expected SHA-256 is `1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a` (130,680 bytes). Recalculate from the exact release archive; do not regenerate the manifest checksum to make a mismatch pass.
- Require a backup inside the agreed recovery-point objective, verified checksum and `pg_restore --list`, a protected globals export, and a separately restored copy with role/ACL/owner/data comparison and application verification. A backup that has not been independently restored is not a recovery gate.
- Do not stop here if the backup contains no usable login/session signing configuration outside PostgreSQL. Existing session rows are preserved in the archive, but session continuity also depends on the protected application signing secret and the same auth configuration being restored through the normal secret manager.

### 2. Verify the 019 boundary and close signup

Using the exact release tree, the separated migration identity, and no dotenv fallback:

```sh
COCINACORE_SKIP_DOTENV=1 \
COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
node frontend/scripts/run-migrations.js --lane migration --verify-boundary 019

COCINACORE_SKIP_DOTENV=1 \
COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql \
node frontend/scripts/run-migrations.js --lane migration --dry-run
```

Inject `MIGRATION_DATABASE_URL` through the authorized secret mechanism. It must identify `migration_admin`, not a LOGIN application role or a superuser. Record the exact boundary and pending-set evidence without logging the URL.

Set server-side `COCINACORE_SIGNUP_MAINTENANCE=true` for the application release and restart/reload the application through its approved process manager. The signup handler reads this server environment variable before parsing the request, rate limiting, database lookups, or transactions. Unset or exact `false` disables it; every other set value fails closed as maintenance. Verify a real HTTP POST returns the generic 503 response and no cookie, and compare tenant/user/membership/session counts before and after. Verify a pre-existing account can still log in. Do not reopen automatically.

Repository inspection found no other public API route that calls `createUser` or `createTenant`; the server-controlled signup route is the one account-creation entry point found. Keep that check in the release review; do not infer the absence of bypasses from the maintenance unit test alone.

### 3. Prepare, migrate, and verify activation pending

Prepare inert capabilities as a single transaction using the exact candidate and an authorized database provisioner:

```sh
psql -X -1 -v ON_ERROR_STOP=1 \
  -v metrics_password="$METRICS_ROLE_SECRET" \
  -v global_writer_password="$GLOBAL_WRITER_SECRET" \
  -U "$PROVISIONER_ROLE" -d "$DATABASE_NAME" \
  -f scripts/provision-020-inert-capabilities.sql
```

The psql variables above are secrets: run without shell tracing, prevent command/history capture, use a protected operator execution channel, and clear the injected environment/input immediately. The preparation provisioner requires those variables only when creating the LOGIN roles. Do not run `scripts/provision-auth-role.sql` between A1-P and 020: its approved contract rejects partially provisioned signup roles. The rehearsed legacy signup path remains available at the 019 boundary before A1-P, not after it.

Apply only the exact pending migration with the restricted runner:

```sh
COCINACORE_SKIP_DOTENV=1 \
COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql \
node frontend/scripts/run-migrations.js --lane migration
```

The runner owns its migration transaction and advisory lock. Expected state immediately afterward is canonical ledger 020 with R4 activation still pending. A read-only `--verify-complete` at this point must reject with `ACTIVATION_PENDING`; this is a hold condition, not a reason to add grants manually.

### 4. Activate R4 and reopen deliberately

After owner approval of the exact release and verified 020 state, run the fixed activator with the separately authorized administrative connection. This connection is not `DATABASE_URL`, `AUTH_DATABASE_URL`, or `MIGRATION_DATABASE_URL` and must never be exposed to application code:

```sh
node frontend/scripts/activate-020-capabilities.js
```

Inject `COCINACORE_ACTIVATION_DATABASE_URL` through the approved, audited secret mechanism. It must satisfy the activator's PostgreSQL 16 administrative-identity check. Do not grant more privileges or memberships to `migration_admin` to make activation work.

Then require all of the following before changing application flags:

```sh
COCINACORE_SKIP_DOTENV=1 \
COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
node frontend/scripts/run-migrations.js --lane migration --verify-complete
```

- Active-capability attestation passes; confirm 71 policies and 27 FORCE RLS application tables.
- SQL smoke checks prove the seven fixed capabilities are granted only to their intended LOGIN roles, PUBLIC and unrelated LOGIN roles remain denied, and tenant A cannot read/write tenant B data.
- HTTP smoke checks use the compatible signup-bootstrap release: `COCINACORE_SIGNUP_BOOTSTRAP_ENABLED=true`, separate auth/data identities, and a test signup/login/reset flow.
- Keep `COCINACORE_SIGNUP_MAINTENANCE=true` during activation and all checks. Only after the compatible release and bootstrap setting are confirmed, explicitly set maintenance to exact `false`, reload the app, and recheck one successful signup plus login. Reopening is a separate owner-approved action; no script does it automatically.

The disposable rehearsal exercised all these checks. It did not validate deployment infrastructure, external secrets injection, live traffic, or the production application process manager.

## Failure and recovery matrix

| Scenario                      | Evidence and required response                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Before A1-P               | 019 backup restored independently; legacy signup created tenant/user/owner membership/session. If a gate fails here, keep the 019 application and database unchanged.                                                                                                                                                                                                               |
| B — During A1-P               | Injected DDL error rolled the complete transaction back: no role/object/ACL/data/ledger residue. Retry only after fixing the actual cause and rechecking 019.                                                                                                                                                                                                                       |
| C — During 020                | Injected policy-creation error through the official runner left the exact inert prepared state; no 020 ledger entry or policy/ACL residue. Keep maintenance on; correct the release defect before retry. Do not edit 020's checksum or grant legacy INSERT.                                                                                                                         |
| D — 020 committed, R4 pending | Legacy direct INSERT is denied and `--verify-complete` rejects pending activation. Keep signup in maintenance. Do not restore auth INSERTs or deploy the old signup writer.                                                                                                                                                                                                         |
| E — R4 fails after a grant    | The real activator failed after the first GRANT; its transaction removed all partial grants and complete verification continued rejecting the state. Diagnose and rerun only the fixed reviewed activator; never issue manual grants.                                                                                                                                               |
| F — R4 complete               | Active attestation, owner metrics, global writer, compatible signup/login/password-reset, and controlled maintenance behavior passed. Reopen signup only via an explicit release/owner action after the acceptance gates above.                                                                                                                                                     |
| G — Old application after 020 | A real `cocinacore_auth` direct `INSERT INTO tenants` was denied after 020 and no data changed. Therefore code-only rollback to the legacy direct-INSERT signup implementation is **not compatible**. Keep maintenance on; use a compatible release or an isolated, verified backup restore and separately approved cutover. Never disable FORCE RLS or widen grants as a rollback. |

020 itself is transactional: a failed migration rolls back to the separately committed A1-P inert state. After 020 commits, there is no rehearsed inverse migration. A restore is a separate recovery/cutover operation, not an in-place `--clean` restore. Do not switch application traffic to a restored cluster until its identity, role state, ACLs, ledger, `--verify-complete`, data, and application smoke checks pass.

## Post-020 backup restore acceptance

The disposable rehearsal took a second custom-format archive after R4, restored it into an independent PostgreSQL 16 tmpfs cluster after restoring global role identities, and required:

- Exact migration ledger through 020 and official `--verify-complete`.
- Exact catalog structures/policy expressions and 71 policies; 27 public application tables FORCE RLS.
- Seven prepared/active capability objects and four restricted NOLOGIN owners.
- Exact application role attributes, settings, comments, memberships and effective ACL snapshot; application object owners match. Restore-superuser extension ownership is accepted only by the existing extension contract.
- Fixture contents and relationships, including two tenants, users/memberships, sessions, inventory/movements, recipes/versions, plans/suggestions, shopping, profiles/terms, tenant/global books/PDFs/chunks, owner/report metrics.
- Active owner metrics and global writer; restored auth capability creates tenant/user/owner membership plus session; runtime tenant A sees its own inventory and cross-tenant writes fail; runtime/auth cannot read unrelated capabilities.
- Real HTTP compatible signup/login/reset flow on the restored cluster.

The run proves PostgreSQL data/role recovery in a controlled cluster; it is not a tested production failover or traffic cutover plan. Persisted secrets and external services (mail, rate limiting, storage, Supabase REST) require independent recovery configuration.

## Reproduce this rehearsal

From the repository root, with Node 22.22.3 installed and the PostgreSQL 16 image already cached:

```sh
/bin/bash scripts/test-020e-b-recovery.sh
```

The script refuses network image pulls, pins the canonical 020 hash/size, binds ephemeral ports to loopback, uses tmpfs-only database storage and a private temporary directory, compares role/ACL/owner/catalog/data snapshots, and removes its named containers/temp files on success or failure. It must print `PASS cleanup` on completion. This rehearsal is evidence about the candidate only; do not run it against persistent database URLs.

## Boundaries and outstanding work

- `premiumBoardService` uses a separate Supabase REST boundary. The PostgreSQL role tests do not prove that REST credential, project policy, or service-role access is least-privileged.
- Tenant invitations are not an end-to-end validated write flow. The runtime receives only six summary columns under tenant RLS; invitation token/acceptance metadata and the `accept_tenant_invitation` capability remain outside the reviewed application contract. Do not infer invitation usability or security from the database restore checks.
- The daily backup checker does not perform a restore; 020 needs a recurring independent restore exercise and role/global snapshot handling before any persistent-change decision.
- No production approval, backup access, Contabo operation, Supabase operation, or deployment was performed in 020E-B.

## Abort criteria

Abort and keep/return signup to maintenance if the release SHA, 020 checksum, pending set, backup checksum/listing, independent restore, roles/ACL/owners, ledger, R4 attestation, HTTP/SQL acceptance, or application release compatibility differs from this contract. The remedy is a corrected reviewed release or a separately approved isolated restore—not an emergency privilege expansion.
