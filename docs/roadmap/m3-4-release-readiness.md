# M3.4 Release Readiness — Draft

**State:** Local feature branch only; not ready for PR or release. U5 browser proof and issue/PR decisions remain open.
**Branch:** `feat/m3-4-inventario-porciones`, based on `origin/main` at `52dd9fd45b759677fe996a6c477951acd363733a`.

## Local work units

| Slice | Commit | Scope | Changed lines |
|---|---|---|---:|
| U1 | `5eae3ae804ac324e9eca4d4fdd424acf69a05c22` | Quantitative Today availability details | 248 |
| U2 | `b21b81c870ff43d34636ef05825ade1843aa3d2e` | Explicit target portions and scaling | 346 |
| U3 | `ec83076c56ea27c4c3328e7a81174d91e483db91` | Structured quantity provenance | 286 |
| U4 | `f151295461235590cae9f1ef7c3dc017d9d612d9` | Ephemeral user confirmation of current quantities | 306 |
| **Total** | | Four focused, dependent work units | **1,186** |

Each unit is below the 400 changed-line review budget. The proposed PR order is U1 → U2 → U3 → U4; later units build on earlier Today UI/API work. No PR or push has been created. Before PR preparation, identify an issue with `status:approved`, verify its scope, choose the chained-PR strategy, and use exactly one matching `type:*` label per PR. Current issue reference and PR strategy: **not selected**.

## Verification evidence

- U1: 74 focused Today tests; full suite at that commit 813 passed/8 skipped; TypeScript/build/lint and GGA passed; its exact native review was approved and acknowledged.
- U2: 38 focused tests; full suite at that commit 831 passed/8 skipped; TypeScript/build/targeted ESLint/differential compatibility/GGA passed. Native ASSESS was unassessable due undeclared untracked ODD notes; no native reviewer run.
- U3: 107 focused tests; full suite at that commit 837 passed/8 skipped; TypeScript/build/lint/GGA passed, with one existing lint warning. Native ASSESS was unassessable for the same untracked-note reason; no native reviewer run.
- U4: 24 focused helper/UI tests; current full Vitest 845 passed/8 skipped; TypeScript, production build, and GGA passed. Full lint exited 0 with 0 errors and one existing warning at `frontend/src/next.config.test.ts:6`. Native ASSESS was unassessable because untracked ODD notes require explicit declaration; no candidate or `reviewDue` was returned, and no review transaction was started.
- No PR CI has run. No production database, migration, acceptance workflow, deployment, or production write was used.

## U5 browser proof — blocked

The React component tests exercise explicit confirmation, edits revoking confirmation, confirmed zero, duplicate ingredients, and unknown/estimated quantities. The regular Playwright configuration starts a provider server on port 4319 and an app server on port 4320, validates database/Redis targets, and the connected Today journey creates a synthetic account/profile behind `COCINACORE_ISOLATED_E2E=1`. That setup was not run: no disposable validated DB/Redis target or safe mocked port-3000 browser route has been authorized. Do not point synthetic writes at the original or production database, and do not start parallel servers. Owner decision required: authorize a safe browser-test route/fixture, or accept the current unit/full-suite verification without Playwright.

## Release gates still required

- Resolve U5 browser-proof decision and record the result.
- Identify the exact `status:approved` issue and confirm its scope before creating any PR.
- Select a PR chain strategy for the four dependent slices; keep every PR under 400 changed lines, include the repository template, and add exactly one `type:*` label.
- Push/PR publication and CI results remain unperformed; record them only after authorized execution.
- Before any future production work, separately authorize and verify backup, migration ledger, acceptance, cleanup, and deployment gates. No merge, migration, production acceptance/write, or deployment is authorized by this draft.

## Current non-goals

No M4 predictive work; no M3.3 planning/guided cooking/consumption/reconciliation; no database migration; no merge, production acceptance, or deployment.
