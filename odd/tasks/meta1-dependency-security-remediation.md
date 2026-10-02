# META1 Dependency Security Remediation

## Goal
Resolve the release-candidate Next.js and PDF.js security risks with the minimum justified dependency and runtime changes, then verify them locally and on disposable infrastructure. Do not commit or access production resources.

## Constraints
- Work only in `/Users/yoryiabreu/proyectos/cocinacore`; preserve the current branch and do not start META 2.
- No production/VPS/persistent database access, push, PR, merge, deploy, or automatic `npm audit fix`.
- Do not modify `.atl/skill-registry.md` or `.codegraph/`.
- Keep changes limited to justified dependency/platform files and the specifically requested PDF regression coverage.
- At initial validation close, no commit was authorized. This follow-up explicitly authorizes one normal Guardian-gated commit for the nine listed remediation files only; no push, PR, merge, or deploy.

## Tasks
- [x] **Confirm dependency/security/runtime evidence and candidate resolution.** Verified official package/advisory metadata and Node lifecycle; challenged the Node 20 vs 22 assumption; tested candidate lockfiles in disposable copies.
- [x] **Apply the minimum dependency/platform update.** Updated Next/PDF.js, Node 22 pins, PostCSS and vulnerable transitive packages; synchronized the PDF.js worker; added focused browser coverage. Strict TDD RED and GREEN both observed.
- [x] **Run the requested validation gates.** Node 22 install/audit, unit/type/lint, Next build, Node22-Alpine Docker build, separated disposable migrations, Chromium E2E, and PDF upload/parsing checks are complete. One full-suite attempt had an isolated-user setup failure; the fresh-database rerun passed all tests.
- [x] **Inspect and report.** Confirmed branch/HEAD unchanged, scoped diff, preserved pre-existing state, and no commit; final report records passed gates and recovered setup attempts.

## Evidence
- Baseline: `3fc29f1a55c08eb2051152d651510dc062ffc357` on `feature/meta1-m1-2-meal-planner-contract`.
- Historical pre-existing state: `.atl/skill-registry.md` modified and `.codegraph/` untracked; do not alter either.
- Official Node.js EOL page marks Node 20 EOL as 2026-03-24; PDF.js v6.3.289 package metadata requires `>=22.13.0 || >=24`; Next v16.3.8 package metadata requires `>=20.9.0` and accepts React 19.
- TDD mode: **strict enabled**, source: explicit user selection in this conversation after project/global settings showed no configured mode. Exact focused runner: `cd frontend && npm run test:e2e -- e2e/specs/pdfjs-upload-compat.spec.ts` (Playwright script from `frontend/package.json`). The test requires disposable E2E infrastructure and explicit platform-owner credentials.
- TDD RED observed on the pre-change candidate: disposable migrations and owner bootstrap succeeded; the PDF upload test reached the worker response and failed only because it served v5.7.284 rather than required v6.3.289. Post-version text-extraction/upload-success assertions were not reached yet.
- GitHub advisory GHSA-hq66-cqwq-w95j identifies `pdfjs-dist` versions `>=5.6.83, <6.2.108` as affected; current 5.7.284 is affected, and fixed v6.2.108+ requires Node 22.13+. No maintained safe Node-20-compatible 5.x release was established.
- Implemented versions resolve Next/eslint-config-next 16.3.8, pdfjs-dist 6.3.289, `@types/node` 22, PostCSS 8.5.23, Vitest 4.1.11, and the fixed transitive packages. Standard `cd frontend && npm ci` and `npm audit --json` passed; audit reported zero vulnerabilities.
- The lock diff is 1,306 lines. Entry comparison against baseline: 16 added, 2 removed, 105 updated (including root metadata). Changes are limited to Next/SWC, PDF.js/canvas, PostCSS, audit-affected transitive packages, Vitest/Vite/Rolldown, and platform-specific optional bindings induced by those dependencies; no other root direct packages changed.
- Host checks: Node `v22.22.3`, npm `10.9.8`; unit suite 48 files / 406 tests passed; TypeScript passed; lint passed with one existing `window.location.href` warning in `frontend/src/app/app/page.tsx:83`.
- Separated disposable DB provision, bootstrap-lane dry-run, migration-lane dry-run, 12 migrations applied, and migration-ledger verification all passed. Direct Next build and Node 22 Alpine Docker build passed.
- Strict-TDD PDF E2E produced RED on v5.7.284 then GREEN on the exact v6.3.289 worker; the full Chromium suite passed 32/32 with a unique owner identity and regular-user signup fallback.
- Recovered attempts: root-level `npm ci` failed because the package boundary is `frontend/`, then `cd frontend && npm ci` passed. The first full E2E attempt had 11 pass / 19 regular-user login failures / 2 not run after only owner credentials were seeded; a fresh, isolated DB with a distinct owner address passed all 32. A migration setup attempt failed when a fresh shell lost the temporary password; both disposable containers were cleaned and the rerun passed.
- `npm ls --depth=0` exited 0 and listed six optional/platform WASM packages as extraneous; lock entries explain their optional platform roles.
- Native review inspect returned `intended_untracked_selection_required`; its tracked candidate includes the pre-existing `.atl/skill-registry.md` edit. No START/lineage was created; no review was run to avoid incorporating that unrelated user state. This records the validation close before the current commit authorization; branch and HEAD were then unchanged.
- Product changes are complete. Source changes are limited to `frontend/package.json`, `frontend/package-lock.json`, `frontend/public/pdf.worker.min.mjs`, `frontend/e2e/specs/pdfjs-upload-compat.spec.ts`, `frontend/Dockerfile.dev`, `Dockerfile`, `.github/workflows/ci.yml`, and `.github/workflows/deploy.yml`.
- ODD document created: this file, containing four completed validation tasks. At the validation close before this follow-up, implementation and E2E test were uncommitted.
- Git state recorded at validation close (before commit authorization): branch `feature/meta1-m1-2-meal-planner-contract`; HEAD `3fc29f1a55c08eb2051152d651510dc062ffc357`. Pre-existing `.atl/skill-registry.md` modification and `.codegraph/` untracked directory remain untouched.
- Native review preflight required intended-untracked selection and included the pre-existing `.atl/skill-registry.md` tracked change; no START or review lineage was created to avoid reviewing unrelated user-owned state. No commit, push, PR, deploy, or persistent-database access occurred during the original validation; the current follow-up authorizes only the specified commit.
