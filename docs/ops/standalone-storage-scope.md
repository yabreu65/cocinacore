# Standalone S3 storage scope

The current application uploads files only through the platform-owner global PDF route. The existing private PDF route supports deletion of legacy tenant records; no tenant S3 upload lane exists. Do not interpret the standalone deployment as implementing tenant-private S3 document management.

## Fail-closed boundary

- The S3 application identity can read, write and delete only `global-pdfs/*` in the private `cocinacore-documents` bucket. ListBucket is limited to `global-pdfs/*`; GetBucketLocation is bucket metadata only. No public access, root key, group membership or unrestricted object permission belongs to the application.
- Global upload requires a platform-owner session before writing. The S3 adapter accepts the exact global namespace and canonical single-segment global keys only; it refuses private, traversal or ambiguous keys before calling S3.
- Private PDF deletion in S3 mode returns 503 after the existing tenant/role authorization and before deleting any metadata or file. The existing local-storage behavior is unchanged. Never send a private key to the global S3 adapter. Do not silently discard existing private documents or convert their paths.
- The initializer refuses mismatched existing policy, identity or credential rather than broadening permissions. A new deployment uses new volumes and independent credentials.

## Acceptance and future work

The synthetic storage probe verifies S3 PUT/GET/checksum and prefix-scoped LIST, denies unscoped/private LIST, private GET/PUT and anonymous GET, and repeats after a controlled restart. It does not delete objects or exercise platform-owner HTTP upload. Run only with the disposable test flag and explicitly isolated network/credentials. Unit tests cover the global adapter boundary and the private route's fail-closed behavior.

Before switching an existing deployment to this S3 configuration, inventory legacy global and private records and files. If any private document requires S3 operations, stop the cutover until the tenant lane and migration are implemented and accepted. A future tenant lane must use server-derived tenant identity and credentials scoped to that specific tenant prefix; prove same-tenant success and cross-tenant GET/PUT/LIST/DELETE denial. Never grant the global identity access to tenant objects as a shortcut. The platform-owner HTTP PDF upload/metadata flow and production security acceptance remain separate gates.

## First platform administrator acceptance

The first platform administrator is a release prerequisite, not an ordinary tenant owner. `frontend/scripts/bootstrap-owner.js` and `npm run db:bootstrap` remain historical: their direct writes are incompatible with the restricted runtime/RLS lanes, and the script accepts a password as a process argument. Do not use them for F5.6.

A restricted, one-use procedure is implemented in migration 024 and `frontend/scripts/bootstrap-first-platform-admin.js`. The canonical migrations 001–024 and the first-admin integration acceptance passed against a disposable PostgreSQL 16 tmpfs cluster, including one-use and rollback checks. This is implementation evidence only: it does not authorize provisioning on a persistent or production target, approve a target/person, or replace target-specific owner approval.

### Operator installer

From `frontend`, the interactive command is `npm run db:bootstrap:first-platform-admin`. Configure only these non-secret values, using the exact authorized database and administrator email:

```sh
export COCINACORE_FIRST_ADMIN_DATABASE_URL='postgresql://cocinacore_first_admin_provisioner@127.0.0.1:5432/replace-with-exact-db-name'
export COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE='replace-with-exact-db-name'
export COCINACORE_FIRST_ADMIN_EXPECTED_EMAIL='replace-with-authorized-email'
```

The installer accepts only the dedicated provisioner role and a loopback database host. It rejects passwords and connection options in the URL, refuses piped input and command-line arguments, requires the operator to type the exact database name and expected email, and prompts for the provisioner and new administrator passwords with terminal echo disabled. A remote database may be reached only through an owner-approved local port forward; the installer itself never accepts a remote host. Do not place either password in environment variables, command arguments, URLs, logs or repository files.

Before writing, it checks the dedicated role and function grants, FORCE RLS on the required tables, and the pinned migration-024 capability attestation. It calls the one-use database function in a transaction, requires a non-secret owner-approval reference, and does not grant tenant-owner privileges. The installer fails if a platform owner already exists. Do not run it until the owner has explicitly approved the exact target, operator and intended person; no persistent-target run was performed as part of disposable acceptance.

### Standalone Compose procedure

The standalone `operations` service shares PostgreSQL's network namespace so the installer can keep its loopback-only target rule without publishing the database port. Run fresh database bootstrap from a terminal with a TTY; it asks for exact database confirmation and the provisioner password before applying migration 024:

```sh
docker compose -f docker-compose.standalone.yml --profile operations run --rm -it operations /app/bootstrap-db.sh --fresh
```

That command prepares roles and applies migrations; it does **not** create the administrator. After it succeeds, run the operator installer from the same TTY-enabled operations service, supplying only the non-secret target values; the provisioner and administrator passwords are prompted privately:

```sh
docker compose -f docker-compose.standalone.yml --profile operations run --rm -it \
  -e COCINACORE_FIRST_ADMIN_DATABASE_URL='postgresql://cocinacore_first_admin_provisioner@127.0.0.1:5432/replace-with-exact-db-name' \
  -e COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE='replace-with-exact-db-name' \
  -e COCINACORE_FIRST_ADMIN_EXPECTED_EMAIL='replace-with-authorized-email' \
  operations npm run db:bootstrap:first-platform-admin
```

The bootstrap refuses non-interactive stdin/stdout before database preflight or mutation. Keep the two commands as separate operator-confirmed steps.

Before an authorized persistent-target run and acceptance, retain evidence of all of the following:

- **Authorization and target:** the operator, intended person and exact environment are explicitly authorized and verified; platform and tenant ownership remain distinct.
- **Credentials:** secrets are protected during entry, transport and storage, and are absent from command arguments, logs and repository files.
- **Integrity and concurrency:** account and administrator state are consistent, changes are atomic, and concurrent or repeated attempts cannot create unintended administrators or partial records.
- **Existing security contracts:** the procedure is compatible with migrations 001–024, authentication, sessions, `platform_owners` approval and RLS; it does not weaken existing tenant boundaries or grant broad privileges to the application.
- **Audit and acceptance:** record authorization, target, operator and outcome without secrets; verify the intended administrator's `/owner` access and normal-user denial. Separately verify the authorized global PDF upload, metadata, indexing and access controls using RustFS.

Persistent-target provisioning, administrator access acceptance and global PDF acceptance remain open until the owner authorizes the exact run and the relevant evidence is recorded. This guidance does not authorize deployment or use of a persistent database.
