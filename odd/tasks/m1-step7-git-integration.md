# M1 Step 7 — Git integration

## Goal
Audit, validate, stage, commit, open/review/merge a CocinaCore M1 deployment-hardening PR on `fix/pawtech-production-deploy`, without production access or deployment and without starting Step 8.

## Constraints
- ODD only. No RDD, SDD, OpenSpec, M2, or production access/mutation/deploy.
- Preserve exact starting base: branch `fix/pawtech-production-deploy`, HEAD `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`, `origin/main` same. If upstream diverges, stop; never auto-rebase/merge.
- Never read real `.env*`, print secrets, stage production dumps/credentials/temp artifacts, or blindly stage the worktree.
- No dependency install, npx, npm audit fix. Use approved Node v22.22.3/npm 10.9.8.
- Commit/push/PR/merge only as explicitly authorized by Step 7; do not deploy. Stop if a material review blocker exists; Step 8 is not authorized.
- No commit until every requested quality gate passes. No PR until issue/label requirements and delivery-size policy are resolved.

## Current state and evidence
- Fresh `git fetch origin` passed. Branch and both expected refs matched; staged count was 0.
- Initial status: 12 tracked modifications, 12 untracked files, no deletions. The actual path set matched the user's expected list exactly.
- Static map found 354 tracked additions + 439 tracked deletions; untracked files add 3,274 lines; estimated total authored diff is 4,067 lines before this Step 7 tracking document.
- Redacted audit result: `SECRET_SCAN=PASS`; no suspected real credential literals. No secret values were reported.
- Initial material findings are addressed in the current diff: explicit `permissions: contents: read`; runtime `ssh-keyscan` trust removed; required `VPS_SSH_KNOWN_HOSTS` is checked for nonempty and matching host, and deploy/rollback both require strict checking with only the configured user known-hosts file trusted. The PM must provision this GitHub Environment secret from an independent trusted source before any future deployment; its existence/value remains unverified. No deploy/production operation was run.
- PR size exceeds the 400-line review budget; user explicitly approved one PR with `size:exception`. Approved linked issue #6 is OPEN with `status:approved` (verified via GitHub issue metadata). Branch-PR policy still requires exactly one `type:*` label before PR creation.
- Original requested gates passed before security remediation. Both strict-TDD focused RED/GREEN cycles passed after their respective changes; contract, `bash -n scripts/deploy-pawtech-production.sh`, and `git diff --check` passed. Full requested suite and final redacted audit must now be rerun. No staging/commit/push/PR/merge has occurred.

## Stable task checklist
1. [x] Fresh Git preflight: fetch, exact branch/HEAD/origin/main, no staged files.
2. [x] Inventory/audit actual changed and untracked M1 files against the user's list; preliminary secret scan reports PASS.
3. [x] User authorized workflow hardening, selected strict TDD, accepted one-PR `size:exception`, and approved issue #6 (OPEN, `status:approved`). Two RED/GREEN cycles updated only `.github/workflows/deploy.yml`, `scripts/tests/test-pawtech-production-deploy-contract.sh`, and `docs/production/runbook.md`: `permissions: contents: read`; required `VPS_SSH_KNOWN_HOSTS` with fail-closed empty/host validation; no keyscan; strict checking on both deploy and rollback; `GlobalKnownHostsFile=/dev/null` so the configured secret is the sole host-trust source; documented independent-source provisioning prerequisite. Secret value/existence is not accessed or verified.
4. [x] Post-remediation verification passed under Node v22.22.3/npm 10.9.8: Bash syntax x3; rehearsal, production, Step4, Step5, bootstrap config, deploy contract; frontend lint (0 errors, 1 warning), coverage (49 files/411 tests; statements 81.37%, branches 74.69%, functions 87.08%, lines 83.66%), typecheck, build, and `git diff --check`. Vite configLoader warning non-blocking. SC2154 absent; raw ShellCheck exit 1 reports pre-existing/unmodified SC1007, SC2034, SC2155 warnings and SC2015/SC2016 info; no fixes made to unrelated scripts. The local Docker/PostgreSQL integration driver was not rerun after workflow-only changes because its resource cleanup was not established; it passed on the pre-remediation baseline. This skip is disclosed.
5. [x] Final audit matched exact candidate scope: 12 tracked modified + 13 expected untracked, zero staged, zero deletions/unexpected. Redacted scan reports `SECRET_SCAN=PASS` on audited files; latest additions contain only a secret reference, no value. `git diff --check` clean; no `.env*` content read. Independent risk review found one low test-guard gap (permissions assertion) which was corrected; focused contract passed, no material security finding remains. The required GitHub secret remains unconfigured/unverified; no deployment.
6. [x] Explicitly staged exactly the 25 audited M1/ODD paths; cached path list matches the audited set, no unstaged changes/deletions/unexpected paths, `git diff --cached --check` passes. Size is 3,727 insertions / 440 deletions.
7. [x] Created Conventional Commit `feat(deploy): prepare PawTech M1 production release`: `d41c70ccc1db516edbd9bd57417b5e2b8467a3b0`. Active pre-commit GGA review returned `STATUS: PASSED`; no bypass used. Commit contains exactly the 25 audited paths (3,727 insertions / 440 deletions).
8. [~] Push only the authorized feature branch; create the required PR after approved issue/label/size conditions are met. A post-commit `.atl/skill-registry.md` local generated-registry diff (23 insertions / 32 deletions) appeared outside the candidate; it contains local skill paths, is unstaged, and is preserved/excluded. Do not add it.
9. [ ] Review actual PR diff and CI; merge only with all checks passing, no blockers, and no incompatible main divergence. Do not deploy.
10. [ ] Record final Step 7 outcome and stop; no Step 8.

## Categorized audit draft
- A — production workflow: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`.
- B — backup: `scripts/backup-pawtech-cocinacore-predeploy.sh`.
- C — migration verification: `frontend/scripts/run-migrations.js`.
- D — Docker/runtime: `Dockerfile`, `docker-compose.prod.yml`.
- E — auth/session: `frontend/src/lib/auth/session.ts`, `frontend/src/lib/auth/session.test.ts`, password-reset request test.
- F — tests/contracts: bootstrap integration/config tests, M1 rehearsal/production/Step4/Step5 contracts.
- G — docs/ODD: README, production runbook/reality-first, Step5/Step6/deploy-contract tasks.

## Progress rule
Update this document, Engram mirror, and visible TODO projection after each task transition and material scope/decision change. Stage/commit/PR state is not inferred from a checkbox; record command evidence and exact identities.

## Current outcome
`STEP7_COMPLETE=NO`. `READY_FOR_M1_PRODUCTION_DEPLOY=NO` until PM provisions and verifies `VPS_SSH_KNOWN_HOSTS` from an independent trusted source. Commit `d41c70ccc1db516edbd9bd57417b5e2b8467a3b0` was created with exact 25 audited M1/ODD paths; Conventional subject `feat(deploy): prepare PawTech M1 production release`; active pre-commit GGA review passed. Post-commit status shows only an unrelated, generated local `.atl/skill-registry.md` modification (23 insertions / 32 deletions), preserved and not staged. Approved issue #6, size exception, security hardening, checks, and final audit are complete. The local Docker/PostgreSQL integration driver was not rerun post-fix; its baseline passed pre-remediation and the change is workflow-only. ShellCheck SC2154=0; raw exit 1 due disclosed unmodified warnings. Next push the exact feature branch without rebase, open PR with `Closes #6`, exactly one existing `type:feature` label and written size-exception approval; do not include `.atl`. Wait for CI/review before merging. No deployment/Step8.