# M2 Production Closure Record

**Evidence date:** 2026-10-16 (America/Caracas)
**Status:** Production deployment verified; technical closure with explicit follow-ups.
**Scope:** CocinaCore only. Documentation-only change; no database mutation or redeployment performed for this record.

## Release identity and provenance

- Release SHA: `18186522da60a9dcfc4b45e62ab54fee410efb03`.
- Remediation PRs #15–#18 integrated in main.
- Official GitHub Actions deploy run: [38914224895](https://github.com/yabreu65/cocinacore/actions/runs/38914224895), `completed/success`, finished 2026-10-16 14:19:04 UTC (10:19:04 Caracas).
- VPS: `vmi3361868`; production repository at `/opt/pawtech/apps/cocinacore`, observed HEAD `1818652` and clean worktree.

## Direct production observations

Read-only SSH inspection via alias `pawtech` on 2026-10-16:
- Docker container `cocinacore-web` running image `cocinacore:deploy-18186522da60a9dcfc4b45e62ab54fee410efb03`; Docker inspect `running=true`.
- Internal `/api/health` response `status: ok`; dependencies `database.status: ok` and `redis.status: ok` (observed 14:35:54 UTC).
- Public HTTPS health endpoint `https://cocinacore.31-220-98-21.sslip.io/api/health` returned HTTP 200.
- PostgreSQL and Redis shared containers reported running/healthy.
- No production writes or application changes were performed in this closure review.

## Migration and backup evidence

- The official successful deployment job [38914224895](https://github.com/yabreu65/cocinacore/actions/runs/38914224895) logs `Migration ledger is complete.`, `MIGRATION_EXPECTATION=NO_OP`, `DATABASE_CHANGED=NO`, and backup markers `BACKUP_CHECKSUM_OK`, `BACKUP_DUMP_VALID`, `BACKUP_OK`. The predeploy backup was created at 14:18 UTC and checked before cutover. The prior operator reports migrations 013/014 were applied; the deploy verifier confirmed no pending migration.
- **Evidence limitation:** this closure inspection did not independently export each ledger row and checksum; backup verification receipts exist in the protected GitHub deployment job logs, but no restore test was performed, and did not perform a restore drill. These are not represented as newly verified.
- Never publish secrets, database dumps, backup paths or credentials in this document.

## Acceptance decision

**M2 deployed: YES.** Exact release image is running, the official deployment succeeded, and internal/public health checks passed.

**Operational/functional closure: CONDITIONAL.** Authenticated smoke tests for Today, profile, Redis rate limiting and RAG behavior have not been independently executed in this review. Record their receipts before claiming full feature-level acceptance. Preserve M2 and do not begin M3 until these are addressed under the PM's closure gate.

## Open follow-ups

1. Attach a read-only official migrator verification receipt showing migrations 001–014 and checksums, without exposing secrets.
2. Run authenticated functional smoke checks for M2 (Today, culinary profile, authenticated identity/rate limits, RAG timeout and PostgreSQL connection bounds); remove any test data.
3. Retain restricted backup checksum and recovery references; a successful `pg_restore --list` is **not** a restore test.
4. Obtain separate human sign-off if required by the M1-style governance process.
5. Merge this documentation PR after CI; its existence alone is not proof it is integrated in main.

## References

- [M1 closure precedent](m1-production-closure.md)
- [Production runbook](runbook.md)
- [Production evidence discipline](production-reality-first.md)
