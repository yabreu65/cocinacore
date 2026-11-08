# M5 Runtime ACL and Ledger Readiness

## Goal
Preserve the minimum runtime ACL contract after the M5 provisioner transfers ownership to `cocinacore_schema_owner`, while keeping the migration ledger readable but read-only for `cocinacore_user`.

## Scope and rollback
- Worktree: `/Users/yoryiabreu/.codex/worktrees/m5-prod-prep/cocinacore`.
- Branch: `fix/m5-runtime-acls-ledger-read`.
- Base: `156f64ed49db62bf68475f2db498069e8f0d5005`.
- Initial implementation candidate: `d3bce43580a26cbe16b7b5e1ad179694e6ee6c8c`.
- Rollback boundary: revert the provisioner ACL contract, its focused unit/real-PostgreSQL tests, and the migrator integration harness assertions; do not alter migrations or production state.
- No production database, deployment, migration execution, or credential changes are in scope.

## Completed implementation
- Added a fixed, reviewed per-table runtime ACL allowlist and verifies the runtime cannot access six premium/suggestion tables.
- Provisioning retains only explicit application grants after ownership transfer; `schema_migrations` receives runtime SELECT only under one exact SELECT policy, with no write privileges.
- Added real PostgreSQL disposable checks and opt-in runtime repository integration coverage for ordinary application operations and ledger reads.
- The runtime role's LOGIN/NOLOGIN flag is intentionally not fixed by the ACL contract: the legacy canonical-email upgrade fixture uses NOLOGIN, while the application integration harness separately exercises a real LOGIN role.

## Verification and review attempt record
- Runtime boundary: PostgreSQL 16 disposable bootstrap/migrator integration passed, including application repository operations, ledger reads, write denial, premium-table denial, and all 31 table privilege expectations.
- Focused checks passed: 20 provisioner tests, canonical-email integration, TypeScript, lint (one existing unused-variable warning), full Vitest (1042 passed / 11 skipped), build, shellcheck, actionlint, local E2E (45 passed / 2 skipped), and migration/deployment static contracts.
- Candidate `d3bce43580a26cbe16b7b5e1ad179694e6ee6c8c` received two Codex Guardian attempts: attempt 1 failed because the shell regression self-test expected three manifest-based ledger count assertions after the integration script gained a fourth; attempt 2 passed.
- Current follow-up fixes only that stale self-test expectation in `scripts/test-bootstrap-migrator-integration.sh` (3 to 4). Before its normal pre-commit gate: base/candidate parent `d3bce43580a26cbe16b7b5e1ad179694e6ee6c8c`; staged tree and final commit SHA are recorded by Git after staging and the normal commit hook. Effective Guardian attempt budget for this follow-up candidate: maximum four (two Codex, then two configured OpenCode); no bypass is permitted.
- Focused self-tests after the correction passed: `VECTOR_UNAVAILABLE_DIAGNOSTICS_SELF_TEST=yes bash scripts/test-bootstrap-migrator-integration.sh`, `bash scripts/tests/test-bootstrap-migrator-config.sh`, `shellcheck scripts/test-bootstrap-migrator-integration.sh`, `bash -n scripts/test-bootstrap-migrator-integration.sh`, and `git diff --check`.
- The existing unchanged lockfile reports 16 npm audit findings (15 moderate, 1 high); dependency remediation is outside this ACL correction.

## State
- Keep Issue #91 open until production acceptance.
- Do not merge, deploy, apply 018/019 in production, or modify the main checkout or unrelated `.atl/skill-registry.md`.
