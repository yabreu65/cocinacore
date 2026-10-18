# M3.1 production closure record

**Evidence date:** 2026-10-18 (America/Caracas). **Scope:** CocinaCore M3.1 shopping-to-inventory transfer only. **Decision:** Deployment and schema migration verified; functional acceptance in production remains conditional pending an authenticated smoke test. M3.2 is expressly out of scope and must not start before PM/owner discussion.

## Provenance and deployment

- Release: `d07c8e37f62f0cc56bcf0b7462b8bb7be744da2b`, merged into `origin/main` through PR #26, including M3.1 feature and the migration lane corrections from PRs #22–#25.
- GitHub Actions CI run `39141870036`: success on the release SHA.
- Manually approved migration workflow run `39142388860`: success on the release SHA. Logs report `BACKUP_VALIDATED`, `MIGRATION_VERIFIED` with `015_shopping_inventory_transfer.sql`, and `RECEIPT secretless=true database_changed=015-only backup=verified schema_verification=passed`.
- Deployment run `39142896928`: success on the release SHA. Deploy reports `Migration ledger is complete`, `MIGRATION_EXPECTATION=NO_OP`, `DATABASE_CHANGED=NO`, candidate health OK and successful cutover/smoke check.
- Independent read-only VPS inspection on 2026-10-18: repository HEAD `d07c8e3`, `cocinacore-web` container running exact release image `cocinacore:deploy-d07c8e37f62f0cc56bcf0b7462b8bb7be744da2b`. Container-internal `/api/health` and public HTTPS `/api/health` both returned `status=ok`, `database=ok`, `redis=ok`.

## Behavior and regression evidence

- M3.1 adds tenant-scoped, transactional, idempotent transfer from a purchased shopping row to inventory with an explicit user confirmation. The transfer rejects ambiguous units rather than guessing them and preserves the preexisting cooking/consumption behavior.
- Isolated E2E verification is recorded in `odd/tasks/m3-1-shopping-inventory-transfer.md`: focused Vitest 40/40, E2E validator 12/12, connected Playwright 2/2, TypeScript and lint checks passed. Tests used disposable, loopback-only database/Redis containers and not production.
- The successful deployment and health checks **do not establish authenticated end-user acceptance** of the shopping-to-inventory flow in production. No authenticated production smoke was performed as part of this closure record. There is no claim that test shopping/inventory rows were created or removed in the live database.

## Operations, risk, and decision

- No additional migration, restore, manual schema modification, production data write, or service redeployment was performed to create this record.
- Production migration backup was validated by workflow receipts; a verified backup is not a restore rehearsal. Preserve protected backup/receipt references per the production runbook, without recording secrets in this file.
- **Technical release closure: YES** (main integration, migration, deployed image, health, CI, isolated connected behavioral tests).
- **Production functional acceptance: CONDITIONAL** until a controlled authenticated shopping-to-inventory smoke test (purchase, confirmation, durable inventory increase, idempotent replay, tenant isolation) and cleanup receipts can be attached without impacting real data. Do not mark this gate passed without evidence.
- **M3.2: NOT STARTED / NOT AUTHORIZED.** Requires a separate planning discussion with owner and PM; do not use this document as scope or release approval.

## References

- [M3.1 migration operating guide](m3-1-migration-015.md)
- [M3.1 task and isolated acceptance evidence](../../odd/tasks/m3-1-shopping-inventory-transfer.md)
- [Production runbook](runbook.md)
- [CI](https://github.com/yabreu65/cocinacore/actions/runs/39141870036)
- [Migration run](https://github.com/yabreu65/cocinacore/actions/runs/39142388860)
- [Deploy run](https://github.com/yabreu65/cocinacore/actions/runs/39142896928)
