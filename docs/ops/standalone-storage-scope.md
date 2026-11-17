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

The first platform administrator is a release prerequisite, not an ordinary tenant owner. No first-administrator provisioning procedure has been validated for F5.6. `frontend/scripts/bootstrap-owner.js` and `npm run db:bootstrap` are historical: their direct writes are incompatible with the current restricted runtime/RLS lanes, and the script accepts a password as a process argument. Do not use them as the F5.6 procedure or repeat or circumvent previously rejected operations.

Before accepting an authorized procedure, retain evidence of all of the following:

- **Authorization and target:** the operator, intended person and exact environment are explicitly authorized and verified; platform and tenant ownership remain distinct.
- **Credentials:** secrets are protected during entry, transport and storage, and are absent from command arguments, logs and repository files.
- **Integrity and concurrency:** account and administrator state are consistent, changes are atomic, and concurrent or repeated attempts cannot create unintended administrators or partial records.
- **Existing security contracts:** the procedure is compatible with migrations 001–023, authentication, sessions, `platform_owners` approval and RLS; it does not weaken existing tenant boundaries or grant broad privileges to the application.
- **Audit and acceptance:** record the authorization, target, operator and outcome without secrets; verify the legitimate administrator's `/owner` access and normal-user denial, then separately verify the authorized global PDF upload, metadata, indexing and access controls using RustFS.

Initial provisioning, administrator access and global PDF acceptance remain open until a compatible procedure and the relevant evidence are available. This checklist defines acceptance criteria; it does not authorize or specify a provisioning mechanism.
