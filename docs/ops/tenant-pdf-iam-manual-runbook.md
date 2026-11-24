# Private tenant PDF storage: manual provisioning

**HUMAN OPERATOR STEPS ONLY.** This is a handoff, not authorization or evidence of provisioning. The owner must approve the exact target, operator, session, maintenance/recovery plan and later migration/deployment separately. Use an authorized admin session on the owner's Mac; do not bypass a security block. Stop and obtain authorized access if it is unavailable. Do not expose a console, restart services, or modify the global documents bucket or identity.

## Before any change

- Verify the exact target and release, and a **current recoverable backup** with an independent restore receipt covering the database and relevant storage, plus a recovery plan. The November 19 backup is old; do not assume it is current or recoverable.
- Keep all credentials out of chat, terminal history, logs, recordings and commits. Use the approved secret manager and a private operator session; do not give admin credentials to the assistant or the application.
- Review `scripts/standalone-tenant-pdf-policy.json` and the deployed RustFS version's supported IAM operations. The existing `storage-init` operations profile uses `rustfs/rc`, but `scripts/standalone-init-storage.sh` provisions the **global** identity and bucket, not this tenant lane. Do not run or adapt it for this procedure. The existing profile does not mount the tenant policy; arrange an approved read-only policy delivery method without altering the global setup. This runbook intentionally provides no unverified administrative endpoint or credential commands.

## HUMAN OPERATOR STEPS: provision and verify

1. In the authorized session, inspect the bucket, policy, identity, group memberships and effective permissions. A failed or ambiguous inspection is NOT evidence of absence: stop. If the bucket exists, establish its ownership, privacy and intended use before reusing it; if uncertain or conflicting, stop without altering it or its objects. Never reuse `cocinacore-documents`.
2. Create the private `cocinacore-tenant-pdfs` bucket only if its absence is confirmed; keep anonymous/public access disabled. Create a separate tenant service identity, distinct from root and the global application identity. If an identity or policy already exists, reuse it only after independently verifying its ownership and exact intended configuration; unexpected policy content, attachments, group membership, status or permissions are a conflict: stop for human review. Do not overwrite, detach, delete or rotate existing resources as a workaround.
3. Create and attach the reviewed **identity** policy in `scripts/standalone-tenant-pdf-policy.json`, using the deployed client's verified procedure. It grants only `s3:PutObject` and `s3:DeleteObject` on `cocinacore-tenant-pdfs/tenant-pdfs/*`. Confirm the identity is enabled, has no additional policy or group granting broader access, and the effective permissions match. Never make this a public bucket policy. IAM scope does not isolate individual tenants; application authorization must do that.
4. Using only the new identity and non-sensitive synthetic objects, verify PUT and DELETE succeed under `tenant-pdfs/*`. Before deleting the test object, verify GET on it and bucket LIST are denied; verify PUT outside the prefix and access to the global bucket are denied. Use known existing test targets where applicable, so a missing object is not mistaken for access denial. Confirm successful authentication separately; a connection, authentication or inconclusive error is not a permission denial. Stop if any result differs, and clean up only the synthetic objects through the authorized procedure. Record non-secret outcomes, not credentials or object contents.

## HUMAN OPERATOR STEPS: staged activation

1. Only after storage checks pass and the separate change is approved, set server-side `STORAGE_DRIVER=s3`, `S3_TENANT_BUCKET=cocinacore-tenant-pdfs`, `S3_TENANT_ACCESS_KEY_ID`, `S3_TENANT_SECRET_ACCESS_KEY`, `S3_ENDPOINT` and `S3_REGION` in `CC_APP_ENV` via the approved secret mechanism. Use the authorized existing internal S3 endpoint, not a guessed admin endpoint. The tenant bucket and key must differ from `S3_BUCKET` and `S3_ACCESS_KEY_ID`; never expose them to the browser. Do not change global settings.
2. In a separately approved migration window, verify the target, migration ledger and checksums, active 024 capabilities, and exact pending set. Stop on drift or other pending migrations. Apply `025_private_tenant_pdf_creation.sql` using the canonical restricted migrator and migration identity, then verify the ledger and complete capability attestation. Do not run SQL directly or use app/root credentials for migration. Storage setup does not authorize migration.
3. After separately approved activation/deployment, run real authenticated acceptance with a synthetic PDF: same-tenant upload and delete succeed, cross-tenant access is denied, and failures do not expose object URLs or secrets. Verify service health and unchanged global document behavior. Stop and follow the approved recovery plan on failure; do not improvise a rollback or restore.

## Evidence and remaining work

The operator must still perform and record these steps in the authorized environment. Local checks below read repository files only; they do **not** prove live RustFS permissions, backup recovery, migration or acceptance.

```sh
node scripts/tests/test-tenant-pdf-runbook-contract.cjs
node scripts/tests/test-tenant-pdf-policy-contract.cjs
```

See [tenant PDF storage](tenant-pdf-storage.md) for adapter configuration and policy context.
