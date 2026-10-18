# M3.1 production migration 015: operator guide

**This guide documents a controlled, forward-only database operation.** Run it only after the change is merged and the owner has explicitly authorized the operation; a green CI check does not grant production authorization.

## Before requesting the operation

- Select the exact full 40-character commit SHA already integrated into `main`. The workflow is manually dispatched from `main` and independently checks that the requested commit is in `origin/main`.
- **Manual approval for private GitHub repository:** The owner approved the M3.1 migration/deployment in the project conversation on 2026-10-18. This GitHub plan does not support required environment reviewers for this private repository (API HTTP 422). The `production` Environment retains its scoped secrets, strict host-key checking, and shared non-canceling `deploy-production` concurrency, but **does not enforce human review**. The operator must independently verify the owner's authorization and supply the required `approval_reference=M3.1-015-20261018-owner-approved` input. That input is an explicit, auditable operator acknowledgement **not an access-control substitute**. Do not start the workflow without recorded owner authorization.
- Confirm the environment's SSH credentials and trusted `VPS_SSH_KNOWN_HOSTS` entry are maintained under existing access controls. SSH uses strict host-key checking; never substitute `ssh-keyscan` or disable verification.
- Require a **fresh** migration preflight immediately before any approved migration attempt. Do not reuse old observations or evidence.

The SHA validation uses the remote `origin/main` reference already fetched by `actions/checkout` with `fetch-depth: 0`, rather than a second unauthenticated `git fetch` (which fails for this private repository). Checkout credentials remain non-persistent.

The workflow transfers a checksummed archive built from the selected SHA; the VPS does not fetch or checkout Git source. The database credential is read only from the existing VPS runtime environment `/opt/pawtech/env/cocinacore.env`. It is never transferred to GitHub, printed, or changed. No replacement credential or database role is provisioned.

## Fail-closed procedure

Any baseline mismatch or failed check means **stop**. Do not retry automatically, edit the runtime configuration, or proceed by overriding a check.

1. The exact-SHA image checks database identity (`cocinacore_db` / `cocinacore_user`), the pending migration ledger (015 only), zero rows in `shopping_list_items`, relation footprint at most 81,920 bytes, and absence of waiting locks or idle-in-transaction sessions. PostgreSQL lock and statement timeouts are set for both preflight and the canonical runner. The canonical dry-run validates the ledger before backup.
2. Before DDL, the exact-SHA versioned CocinaCore-only backup helper writes a custom-format backup for `cocinacore_db`. The operator path requires private artifact/checksum permissions, SHA-256 validation, and `pg_restore --list` archive validation. A failed check halts the operation; preserve the artifact and investigate.
3. Only the canonical runner applies the exact pending migration transactionally. No provisioning, deployment, application cutover, automatic retry, or shared-infrastructure change is part of this procedure.
4. The canonical complete verification runs read-only after migration. Preserve the secretless `BACKUP_VALIDATED` and `MIGRATION_VERIFIED` milestones plus the final receipt (`backup=verified`, `schema_verification=passed`, `database_changed=015-only`); together they identify the selected SHA and migration. Never include a connection string or credential in receipts, logs, tickets, or this repository.

## Recovery and scope boundaries

There is **no automatic database restore**. A backup and successful integrity check do not imply that restore is authorized or that a restore has been rehearsed. Any restore decision requires separate authorization and an approved recovery plan. On failure, stop and escalate with non-secret evidence; do not rerun automatically.

The existing Deploy workflow and deploy script remain unchanged and Deploy stays `NO_OP` for database migration: this procedure does not authorize or trigger an application deployment. It creates no shared services, networks, roles, or other shared infrastructure. Bounded temporary-work cleanup must not remove the preserved backup or evidence.

## Review checklist

- [ ] Exact SHA is integrated into `main`; owner authorization has been independently confirmed; the required manual approval reference is supplied. Do not claim GitHub reviewer enforcement is available.
- [ ] Fresh preflight passes with the expected database identity and 015-only pending ledger.
- [ ] Baseline is clean: zero items, relation at most 81,920 bytes, and no lock/session blockers.
- [ ] Backup precedes DDL and passes private-permission, checksum, and archive-list checks.
- [ ] Migration receipt is secretless; post-verification is read-only.
- [ ] No automatic restore, retry, deployment, provisioning, or shared-infrastructure change occurred.
- [ ] No production execution is inferred from this PR; separate authorization is required.
