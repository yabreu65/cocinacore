# M3.4 Release Readiness — Draft

**State:** Local feature branch only; PR preparation is authorized under approved issue #52. No PR or CI run has been created yet. U5's local isolated-browser proof remains blocked.
**Branch:** `feat/m3-4-inventario-porciones`, based on `origin/main` at `52dd9fd45b759677fe996a6c477951acd363733a`.

## Local work units

| Slice | Commit | Scope | Changed lines |
|---|---|---|---:|
| U1 | `5eae3ae804ac324e9eca4d4fdd424acf69a05c22` | Quantitative Today availability details | 248 |
| U2 | `b21b81c870ff43d34636ef05825ade1843aa3d2e` | Explicit target portions and scaling | 346 |
| U3 | `ec83076c56ea27c4c3328e7a81174d91e483db91` | Structured quantity provenance | 286 |
| U4 | `f151295461235590cae9f1ef7c3dc017d9d612d9` | Ephemeral user confirmation of current quantities | 306 |
| **Total** | | Four focused, dependent work units | **1,186** |

Each unit is below the 400 changed-line review budget. Owner selected **Stacked PRs to main**, in order U1 → U2 → U3 → U4; later units build on earlier Today UI/API work. Issue #52 is verified OPEN with `status:approved` and `type:feature`, and is limited to M3.4 development/PRs; it does not authorize merge or production. Planned branches are `feat/m3-4-u1-availability` (base `main`, 248 lines), `feat/m3-4-u2-portions` (base U1 branch, 346 lines), `feat/m3-4-u3-provenance` (base U2 branch, 286 lines), and `feat/m3-4-u4-confirmation` (base U3 branch, 350 lines including U6 documentation). PRs and CI are not yet created. Each PR will link #52 and carry exactly one `type:feature` label.

## Verification evidence

- U1: 74 focused Today tests; full suite at that commit 813 passed/8 skipped; TypeScript/build/lint and GGA passed; its exact native review was approved and acknowledged.
- U2: 38 focused tests; full suite at that commit 831 passed/8 skipped; TypeScript/build/targeted ESLint/differential compatibility/GGA passed. Native ASSESS was unassessable due undeclared untracked ODD notes; no native reviewer run.
- U3: 107 focused tests; full suite at that commit 837 passed/8 skipped; TypeScript/build/lint/GGA passed, with one existing lint warning. Native ASSESS was unassessable for the same untracked-note reason; no native reviewer run.
- U4: 24 focused helper/UI tests; current full Vitest 845 passed/8 skipped; TypeScript, production build, and GGA passed. Full lint exited 0 with 0 errors and one existing warning at `frontend/src/next.config.test.ts:6`. Native ASSESS was unassessable because untracked ODD notes require explicit declaration; no candidate or `reviewDue` was returned, and no review transaction was started.
- No PR CI has run. No production database, migration, acceptance workflow, deployment, or production write was used.

## U5 browser proof — blocked

The React component tests exercise explicit confirmation, edits revoking confirmation, confirmed zero, duplicate ingredients, and unknown/estimated quantities. The regular Playwright configuration starts a provider server on port 4319 and an app server on port 4320, validates local E2E targets, and the connected Today journey creates a synthetic account/profile behind `COCINACORE_ISOLATED_E2E=1`. Local targets are unavailable: the existing Docker resources on 5433/5434/6379/6380 are original/BuildingOS and forbidden; E2E ports 5435/6381 are not running. Do not provision, clone, migrate, reset, or touch those databases.

Static CI review found a safe hosted-runner path: `.github/workflows/ci.yml` creates ephemeral GitHub Actions Postgres/Redis services, runs migrations/bootstrap only on that runner, and runs Playwright there. It does not connect to local or production services. The connected Today synthetic-account test is skipped by the current workflow because `COCINACORE_ISOLATED_E2E` is not set, so CI will not by itself close the specific U5 browser-proof gap. The deploy, production migration, and production acceptance workflows are separate `workflow_dispatch` workflows gated to `main`; a CI dispatch does not invoke them.

The PR workflow trigger filters `pull_request` to base `main`; stacked child PRs targeting parent branches need explicit `workflow_dispatch` of the CI workflow for each exact branch. No such run has been triggered yet.

## Release gates still required

- Resolve the isolated local Playwright target before claiming the full U5 browser proof; do not use the original/BuildingOS Docker resources.
- Create the four stacked drafts under approved issue #52; PR1 targets `main`, later PRs target their immediate parent PR branches. Use the repository template, keep each below 400 changed lines, and apply exactly one `type:feature` label.
- Trigger and record safe hosted CI on each exact PR branch. Child PRs do not receive automatic pull-request CI because the workflow filters base branches to `main`.
- Push/PR publication and CI results remain unperformed; record them only after authorized execution.
- Before any future production work, separately authorize and verify backup, migration ledger, acceptance, cleanup, and deployment gates. No merge, migration, production acceptance/write, or deployment is authorized by this draft.

## Current non-goals

No M4 predictive work; no M3.3 planning/guided cooking/consumption/reconciliation; no database migration; no merge, production acceptance, or deployment.
