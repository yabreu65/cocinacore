# M2 Deterministic Quality Gate (ODD)

## Objective
Implement a CocinaCore-local, fail-closed pre-commit quality gate that separates deterministic Vitest evidence (`TEST_PASS`) from Guardian Angel review (`GUARDIAN_PASS`). Keep the wrapper inactive; do not change Git configuration or the existing shared hook.

## Problem and rationale
Guardian Angel's GGA 2.10.1 parser accepts a model-authored `STATUS: PASSED` even if the response text mentions that Vitest could not start. GGA does not enforce a successful test process. A separate deterministic gate must complete first and remain an independent condition for allowing a commit.

## Authorized scope
This correction may edit only:
- `scripts/cocina-quality-gate.mjs`
- `scripts/tests/cocina-quality-gate.test.mjs`
- This ODD task document.

The `.githooks/pre-commit` wrapper was created for QG-2 and remains unchanged in this correction; it is inactive. Do not edit production M2/GET-409 files, `.git/hooks/pre-commit`, GGA/Gentle Shell, dependencies, permanent `frontend/vitest.config.ts`, `.git/config`, or `core.hooksPath`. Do not stage or commit. Never inspect `.atl/skill-registry.md`, `.env*`, or credentials; do not reset, stash, or clean.

## Contract and acceptance criteria
- Read `.nvmrc` and require the running Node version to match; launch Vitest with the same `process.execPath` so the effective test runtime is verified.
- Run the frontend's full local Vitest suite deterministically in run mode with a fresh JSON report for each invocation.
- `TEST_PASS` requires exit code 0, a valid report from this invocation, at least one collected test/suite, and zero failed tests/suites.
- Assertion failures produce `TEST_FAIL`. Runtime mismatch, runner/startup/report errors, zero collected tests, timeout, or interruption produce `INFRA_UNAVAILABLE` (with an explicit reason). Both outcomes block Guardian.
- Only after `TEST_PASS`, invoke the existing shared Guardian hook directly; do not run `git commit` or recursively invoke a Git hook. An invalid/missing/self-referential Guardian hook fails closed. Guardian exit 0 is `GUARDIAN_PASS`; nonzero/interrupted is `GUARDIAN_FAIL`.
- Commit eligibility is exactly `TEST_PASS && GUARDIAN_PASS`. There is no environment-variable or command-line skip. The Git-level hook remains bypassable through Git controls; CI enforcement is outside this authorized scope.
- `.githooks/pre-commit` remains inactive: no `core.hooksPath` or other Git configuration change.
- Contract tests use controlled doubles for test and Guardian processes. They cover test pass/fail/infrastructure/zero tests/timeout/interruption, Guardian pass/fail, and prove Guardian is not invoked unless tests pass. They must not create real commits or call the real Guardian hook.

## Correction requirements
- Validate Vitest 4.1.11 JSON with complete nonnegative integer counts, consistent suite/test totals, a successful run, `testResults`/assertion statuses consistent with summary counts, and at least one passed assertion. All-skipped/pending, incomplete, contradictory, zero-test, malformed, stale, or nonzero-exit outcomes block Guardian.
- Bind the report to the current child invocation by creating a unique temporary directory, confirming the report path is initially absent, passing that exact path to Vitest, and parsing only after the child exits zero. This is operational provenance, not cryptographic protection against a malicious same-user process/repository.
- Generate a temporary config per run that imports and preserves the original frontend config, changing only controlled report/output and cache locations. Set Vite `cacheDir` and Vitest's nested `test.cache.dir` to run-local paths under the unique temporary directory; Vitest 4.1.11 lets nested `test.cache.dir` override the top-level default. Do not write to `frontend/node_modules/.vite`.
- Cleanup only the unique run directory created by this execution; cleanup failure must be explicit/fail closed. No persistent config changes or new dependencies.

## Tasks
- [x] **QG-1 — Map hook, Node pin, and original gate contract.** Prior read-only work established GGA is shared, `.nvmrc` is `22.22.3`, and Vitest 4.1.11 supports JSON reporting.
- [x] **QG-2 — Implement initial gate and inactive wrapper test-first.** Initial RED was observed, followed by 10/10 GREEN; wrapper remains inactive.
- [x] **QG-3 — Add initial report-edge coverage and verify prior version.** Added malformed/missing/stale-report tests; 12/12 passed. Prior audit found valid-report integrity and shared-cache gaps.
- [x] **QG-4 — Investigate installed Vite/Vitest cache and JSON semantics; preflight target.** Read-only exploration confirms Vitest 4.1.11, Vite 8.3.2, top-level `cacheDir` redirects Vite and Vitest caches, Vitest `test.cache.dir` is deprecated, and a plain temp config can import/spread the original config. Preflight confirmed expected branch/HEAD, empty index, baseline diff hash, and four authorized paths.
- [x] **QG-5 — Strict report validation and per-run cache config, test-first RED→GREEN.** A bounded writer edited only the gate module and contract tests. RED: 14 passed/12 failed, exposing missing strict validation, cache config, and cleanup behavior. GREEN: 26/26 passed. Tests cover count/status consistency, passed assertions, skipped-only rejection, fresh output/config/cache paths, child process results, cleanup, and Guardian suppression. No real Guardian or Vitest was invoked.
- [x] **QG-6 — Prove temporary-config preservation/isolation, then verify isolated execution and cleanup.** Independent config-loader contract found `test.cache.dir` still pointed to shared `.vite` (RED); the gate now redirects top-level and nested caches under the run directory. A test-first export of Vitest-only `runTests` had RED on missing export; GREEN is 28/28 and asserts no Guardian authorization or invocation. Independent verification passed 28 contract tests and syntax checks. In a COW snapshot with only internal copied symlinks, `runTests` returned `TEST_PASS` (154 suites, 581 tests: 574 passed, 7 skipped, 0 failed); config/report/cache paths were inside its owned temp, gate cleanup was verified, and original/copy `.vite` fingerprints stayed unchanged. Exact successful snapshot ownership/removal verified; no Guardian or commit/activation.

## Progress and evidence
- Starting branch: `test/m2-what-cook-today-e2e`.
- Starting HEAD: `60dac4b158926394258601909ff422a6cc2e08e9`.
- Correction preflight: index empty; three known GET/409-related tracked diffs unchanged at SHA-256 `fed697db6fcfd5517dbd73f4e48f1c5c2ed0d23644e803080f31fcdbcbcf70de`; four authorized gate/ODD paths exist untracked; no staged paths.
- Cache exploration: Vite 8.3.2 defaults `cacheDir` to `node_modules/.vite`; Vitest 4.1.11 may prefer nested `test.cache.dir`, then stores its test cache under that base. The existing frontend config is a plain object with aliases and test include/exclude/coverage options; temporary config can import and spread it.
- TDD RED: strict contract suite ran 26 tests before implementation; 12 new expectations failed (14 passed), covering the audit gaps. TDD GREEN: same suite passed 26/26 under Node `v22.22.3` after implementation.
- The implementation generates a per-run config importing the original frontend config, redirects both top-level and nested cache paths, writes report/config/cache beneath one owned temp directory, validates JSON totals against nested assertion statuses, requires at least one passed assertion, and blocks Guardian on every rejected report or cleanup failure.
- QG-6 final independent checks: contract suite 28/28 under Node `v22.22.3`; `node --check` and `sh -n` passed. Config-loader assertions preserve fixture alias/include/exclude/coverage/plugins, report output, and both cache settings within the run root. COW snapshot used `cp -cR`; copied package-manager links resolved inside the copied dependency root and a dependency file matched by hash with distinct inode. Exported `runTests` alone ran full Vitest: 154 suites, 581 tests (574 passed, 7 skipped, 0 failed), `TEST_PASS`, `allowed: false`, `guardianStatus: null`. Config/report/cache paths were captured while live; gate temp dir was removed/absence verified. Target and COW-copy `.vite` fingerprints unchanged (`2d41c2e43c1968a854b8ad18f747b584634c21a709b7d4fe6d62d17ca2d97dda`). Successful snapshot was ownership-checked, removed, and absence verified. One earlier failed-precondition verifier snapshot reported cleanup but its path was not retained, so that separate absence check remains unverified; no broad search/deletion was performed.
- Final target preservation: branch/HEAD correct, index empty, `core.hooksPath` unset, three-path diff hash unchanged (`fed697db6fcfd5517dbd73f4e48f1c5c2ed0d23644e803080f31fcdbcbcf70de`), untracked count 22, no gate/ODD staged. No Guardian, commit, or activation.
- No real Guardian, commit, hook activation, permanent config change, or modification to GET/409 files is authorized.
- Prior audit found report count/authenticity and shared-cache gaps; prior full-suite cache side effects were uncertain because that run symlinked installed `node_modules`. This correction will use a fresh, owned isolated snapshot and verify its cache paths before cleanup.

## Next step
Stop for PM review. The gate remains inactive; do not commit or change Git configuration. Disclose that a prior failed-precondition verification snapshot's cleanup was reported but could not be independently checked because its exact path was not retained; the successful run's snapshot and gate temp were both exactly owned and verified absent.
