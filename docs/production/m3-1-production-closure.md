# M3.1 production closure

**Evidence date:** 2026-10-18 (America/Caracas). **Scope:** CocinaCore M3.1 production migration 015 and application release only. **PM/owner status:** Operational migration/deploy closure is **COMPLETE**; no migration or deployment action remains pending, per PM. This record documents prior production operations; no production change was made during this documentation turn.

## Release and workflow evidence

| Item | Evidence |
|---|---|
| M3.1 feature [PR #22](https://github.com/yabreu65/cocinacore/pull/22) | Merged at `07244a9e599294defae952379d9ee8dde3d841a3`; [CI run 39086633374 succeeded](https://github.com/yabreu65/cocinacore/actions/runs/39086633374). |
| Migration procedure PR #23 | Merged at `a034ab15f4f678ed3e2201c9b298ae834292bc03`; [CI run 39097093129 succeeded](https://github.com/yabreu65/cocinacore/actions/runs/39097093129). |
| SSH lifecycle PR #26 | Merged at deployed SHA `d07c8e37f62f0cc56bcf0b7462b8bb7be744da2b`; [CI run 39141870036 succeeded](https://github.com/yabreu65/cocinacore/actions/runs/39141870036). |
| Migration | [Run 39142388860 succeeded](https://github.com/yabreu65/cocinacore/actions/runs/39142388860) on the deployed SHA. Logs include `BACKUP_VALIDATED`, `MIGRATION_VERIFIED migration=015_shopping_inventory_transfer.sql`, and `RECEIPT secretless=true database_changed=015-only backup=verified schema_verification=passed`. |
| Deployment | [Run 39142896928 succeeded](https://github.com/yabreu65/cocinacore/actions/runs/39142896928) on the deployed SHA. Logs record `DATABASE_CHANGED=NO`, candidate health OK, `CUTOVER_EVIDENCE`, `REMOTE_DEPLOY_READY`, a successful production smoke check, and backup markers `BACKUP_CREATED`, `BACKUP_CHECKSUM_OK`, `BACKUP_DUMP_VALID`, `BACKUP_OK`. Exact release image: `cocinacore:deploy-d07c8e37f62f0cc56bcf0b7462b8bb7be744da2b`. |

## Migration gates

The [migration operating guide](m3-1-migration-015.md) defines the guard criteria: exact integrated SHA and database identity, only migration 015 pending, zero `shopping_list_items` rows and a relation footprint at most 81,920 bytes, no waiting locks or idle-in-transaction sessions, PostgreSQL lock/statement timeouts, and a private backup validated by checksum and archive listing. Run 39142388860 completed with `MIGRATION_VERIFIED` and the `database_changed=015-only` receipt. The run logs do not publish each preflight input value; the post-run values below are attributed to the PM. Deploy records `DATABASE_CHANGED=NO`.

## Independent current production observations

Read-only SSH confirmed that `cocinacore-web` was running the exact release image above. A direct public health GET returned HTTP 200 with JSON reporting `status=ok`, database OK, and Redis OK. These observations are separate from the GitHub workflow results; no internal container health request or repository HEAD query is claimed.

## Operator-reported post-run facts

The PM reports a read-only database snapshot with 15 migration ledger entries through 015, the transfer schema/constraint present, `shopping_list_items` at 0 rows, and 0 waiting locks. These counts were not independently repeated here; no alternate database credentials were accessed. No idle-transaction count is asserted.

The PM also reports temporary-artifact cleanup completed with about 86 GB free. That exact free-space figure was not independently verified in this documentation pass.

## Functional and backup boundaries

M3.1 provides a tenant-scoped, transactional, idempotent transfer from a purchased shopping row to inventory with explicit user confirmation; ambiguous units are rejected rather than guessed. Isolated regression evidence in the [M3.1 task record](../../odd/tasks/m3-1-shopping-inventory-transfer.md) includes Vitest 40/40, validator 12/12, and Playwright 2/2 on disposable local services. This is not production or real-user end-to-end evidence.

No authenticated real-user production shopping-to-inventory end-to-end test was performed or is claimed. This does not leave a production migration or deployment gate pending. The successful deploy smoke check and public health response do not establish authenticated end-user acceptance of the transfer flow.

The migration backup reports `BACKUP_VALIDATED`; the separate Deploy backup reports `BACKUP_CHECKSUM_OK`, `BACKUP_DUMP_VALID`, and `BACKUP_OK`. These receipts validate the backup artifacts, not a restore rehearsal; no restore drill is evidenced by these runs. Absolute production backup paths are intentionally omitted per the M2 production closure policy; use the run IDs above for workflow evidence.

## References

- [M3.1 migration operating guide](m3-1-migration-015.md)
- [M3.1 task and isolated acceptance evidence](../../odd/tasks/m3-1-shopping-inventory-transfer.md)
- [Production runbook](runbook.md)
- [PR #23](https://github.com/yabreu65/cocinacore/pull/23) · [CI run 39097093129](https://github.com/yabreu65/cocinacore/actions/runs/39097093129)
- [PR #26](https://github.com/yabreu65/cocinacore/pull/26) · [CI run 39141870036](https://github.com/yabreu65/cocinacore/actions/runs/39141870036)
- [Migration run 39142388860](https://github.com/yabreu65/cocinacore/actions/runs/39142388860)
- [Deploy run 39142896928](https://github.com/yabreu65/cocinacore/actions/runs/39142896928)
