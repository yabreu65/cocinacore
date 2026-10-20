# M3.2 U5 verifier boolean parser fix

## Authorization

PM authorized a minimal correction for the confirmed backup verifier false negative and regression tests, with a clean branch from `origin/main`, one commit, and a GitHub PR for review. No merge or deploy is authorized.

## Boundaries

- Change only the verifier's PostgreSQL boolean-text acceptance and focused regression fixture/contract coverage.
- Do not touch VPS, backup policy, schema, migrations, deployment policy, roles, services, or production.
- Preserve the current dirty worktree and all local documentation/protected changes.
- Run relevant local tests and shellcheck; push and open a PR only after evidence passes.

## Tasks

- [x] Create clean worktree/branch from `origin/main` at merged SHA `e7479ec8f185bb579d81703006107cbf64dbfd39`.
- [x] Implement the minimal canonical `true/false` parser fix and regression fixture.
- [x] Run focused scenario/contracts/shellcheck and inspect diff.
- [ ] Commit one work unit, push, and open issue-linked PR for review; do not merge/deploy (out of scope for this task).

## Confirmed root cause

The verifier SQL casts `rolsuper` and `rolbypassrls` to text, which returns `true`/`false`. The parser accepted only `t:t`/`f:t`, so `pawtech_root|true|true` was rejected. The prior fixture emitted `f|t` and masked the defect.

## Verification evidence

- `sh scripts/tests/test-pawtech-daily-backup-verification.sh`: PASS; canonical `false|true`, `true|true`, and rejected `false|false` paths covered, including secret-leak, forbidden-operation, and target-isolation assertions.
- `sh scripts/tests/test-pawtech-production-deploy-contract.sh`: PASS.
- `sh scripts/tests/test-pawtech-migration-contract.sh`: PASS.
- `bash scripts/tests/test-pawtech-m1-rehearsal-contract.sh`: PASS.
- `sh scripts/tests/test-pawtech-step4-contract.sh`: PASS.
- `sh scripts/tests/test-pawtech-step5-workflow-contract.sh`: PASS.
- `shellcheck -S error scripts/verify-pawtech-cocinacore-daily-backup.sh scripts/tests/test-pawtech-daily-backup-verification.sh`: PASS.
- `sh -n scripts/verify-pawtech-cocinacore-daily-backup.sh scripts/tests/test-pawtech-daily-backup-verification.sh`: PASS.
- `git diff --check`: PASS.
- An initial `sh scripts/tests/test-pawtech-m1-rehearsal-contract.sh` attempt exited 2 because that existing script requires Bash process substitution; the correct `bash` invocation passed. No source correction was made for that invocation mismatch.

## Commit evidence

- `7302622` — `fix(backup): parse canonical PostgreSQL role booleans`.
- A follow-up documentation-only task-record commit will record final PR evidence; no merge/deploy evidence is expected in this task.
