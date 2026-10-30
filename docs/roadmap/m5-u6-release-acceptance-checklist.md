# M5 U6 — Release and Acceptance Checklist

This document prepares the release and acceptance gates for M5 without performing remote delivery, deployment, production access, migrations, or acceptance runs. It is the local U6 artifact for separating verified local evidence from gates that still require GitHub and owner-authorized production operations.

## Decision

**Local U6 preparation: READY.** M5 U6 is a release-and-acceptance unit, not a new product feature. No application code, migration, or production state is changed by this checklist.

The exact release candidate currently under review is:

| Field | Value |
| --- | --- |
| Repository | `yabreu65/cocinacore` |
| Local branch | `feat/m5-u5` |
| Candidate SHA | `2f8dd3c98bd9cfbc79be22e09e11455d24325274` |
| U6 worktree branch | `feat/m5-u6` |
| U6 base | `2f8dd3c98bd9cfbc79be22e09e11455d24325274` |
| New migration in U6 | None |
| Production operation performed | None |

## Roadmap scope

The approved roadmap defines U6 as **Release and acceptance**:

- integrate quality evidence;
- maintain release documentation;
- verify the backup and migration plan when applicable;
- perform production acceptance only through a separate, explicit gate;
- require exact-SHA evidence, local E2E evidence, read-only production acceptance, and rollback evidence.

U6 does not add household, restaurant, bakery, pastry, or catering functionality. It does not alter U1–U5 contracts, M4 engines, migrations, or production data.

## M5 unit closure matrix

| Unit | Local status | Evidence boundary |
| --- | --- | --- |
| U0 | LOCAL GO | Roadmap, vocabulary, threat model, ownership, and migration boundary were approved locally. |
| U1 | LOCAL GO | Deterministic read-only cooking-intent preview and regression coverage. |
| U2 | LOCAL GO | Explicit recipe/version-to-slot association with conflict, idempotency, and tenant checks. |
| U3 | LOCAL GO FINAL | Durable cooking sessions, migration 018, API/UI, PostgreSQL concurrency tests, and E2E evidence. |
| U4 | LOCAL GO FINAL | Real-consumption reconciliation, migration 019, idempotency, append-only audit, and U4 E2E evidence. |
| U5 | LOCAL GO FINAL | Household-first operational-domain contracts, bounded payloads, role/tenant validation, U5 E2E, and the PDF.js locator correction. |
| U6 | LOCAL READY | This release/acceptance checklist and separation of local, remote, and production gates. |

The unit statuses above are prior local evidence carried into U6; U6 does not re-run or fabricate the prior GGA, CI, or production evidence.

## LOCAL READY

### Candidate integrity

- [x] U5 candidate is based on the approved local SHA.
- [x] U5 commit contains exactly nine authorized files, including the PDF.js E2E correction.
- [x] No U6 migration is required by the roadmap or current implementation.
- [x] Migrations 001–019 and their manifest remain the database boundary for this candidate.
- [x] The U5 worktree's unrelated `.atl/skill-registry.md` change remains outside the candidate.
- [x] GGA history and Codex-only policy are preserved; U6 does not request another review.

### Local evidence carried forward

- [x] Vitest connected run: 1052/1052 passed with disposable PostgreSQL flags enabled.
- [x] U5 connected E2E: 2/2 passed.
- [x] PDF.js focused E2E: 1/1 passed.
- [x] General Playwright E2E: 45 passed, 0 failed, 2 legitimate isolated-run skips.
- [x] TypeScript, ESLint, Prettier, Next.js build, and diff checks passed for the U5 candidate.
- [x] PostgreSQL migrations 001–019, ledger verification, and disposable bootstrap passed.
- [x] Disposable PostgreSQL/Redis resources were removed after testing.

### Local release packet

The local packet should retain, without secrets or private business records:

1. exact candidate SHA and committed path list;
2. migration manifest/checksum evidence for 001–019;
3. sanitized Vitest and Playwright summaries;
4. tenant/role, idempotency, unknown-quantity, no-double-consumption, and no-write evidence;
5. known legitimate skips and their environmental conditions;
6. the rollback boundary: application rollback only unless a separately approved database procedure exists.

## REMOTE PENDING

These gates were intentionally not executed in U6 preparation:

- [ ] Publish the candidate branch or PR.
- [ ] Run exact-head CI and E2E on GitHub.
- [ ] Obtain required review and branch-protection approvals.
- [ ] Verify the exact merge SHA on `main`.
- [ ] Confirm that the merged SHA still contains the complete U1–U5 candidate.
- [ ] Create or update the remote release record without mixing the unrelated `.atl` change.

No remote status is inferred from local tests. A green local suite is not CI approval.

## PRODUCTION PENDING

Production remains a separate owner-authorized operation. Before any deployment or acceptance, the following must be verified against live evidence:

- [ ] Current `main` SHA matches the approved exact release SHA.
- [ ] No concurrent deploy or migration is active.
- [ ] Current application, PostgreSQL, and Redis health is known.
- [ ] The most recent scheduled backup is fresh, readable, integrity-checked, and compatible with the current RLS/schema contract.
- [ ] `DAILY_BACKUP_VERIFIED` is present.
- [ ] Migration ledger and checksums match 001–019; expected database change is explicitly classified.
- [ ] The previous application image/container is retained for application rollback.
- [ ] Rollback and smoke procedures are available and bounded.
- [ ] Production acceptance uses the approved read-only mode unless a separate controlled-write authorization exists.
- [ ] No synthetic writes, purchases, consumption confirmations, migrations, or database restores are performed implicitly.

The absence of production evidence keeps M5 **not deployed** and **not productively accepted**.

## Backup and migration plan

U6 introduces no SQL. The release must therefore treat migrations 001–019 as an immutable compatibility boundary:

1. verify the manifest and checksums before release;
2. verify the production ledger before deployment;
3. classify the release as `NO_OP` only when the exact live ledger proves no database change is required;
4. if a future release requires a migration, stop and create a separately approved migration work unit;
5. never use application rollback as a claim that database state was rolled back;
6. do not attempt restoration during ordinary acceptance.

## Stop conditions

Stop the release path if any of the following occurs:

- the exact SHA changes or is ambiguous;
- CI, review, backup, ledger, health, or rollback evidence is missing;
- a migration is unexpectedly required;
- a test would contact production without the explicit production gate;
- a test would write business data without explicit controlled-write approval;
- tenant/user isolation, idempotency, or unknown-quantity semantics regress;
- a remote or production action would require using the unrelated `.atl` modification.

## Final classification

| Boundary | Status | Meaning |
| --- | --- | --- |
| Local | **READY** | U5 evidence is recorded and the U6 release checklist is prepared locally. |
| Remote | **PENDING** | CI, review, merge, and exact-head verification were not executed. |
| Production | **PENDING** | Backup, deploy, smoke, rollback, and read-only acceptance require a separate authorization and live evidence. |

**M5 is not declared deployed or productively closed by this document.**
