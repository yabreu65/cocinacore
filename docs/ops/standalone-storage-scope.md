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
