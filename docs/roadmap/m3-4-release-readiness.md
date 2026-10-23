# M3.4 Release Readiness — Draft

**State:** Four stacked Draft PRs (#53–#56) are open under approved issue #52. CI passed on exact pre-document-update heads #53, #54, and #56; #55's frontend-quality job passed but its E2E job failed on an unrelated PDF.js locator. This documentation update changes PR #56's head, so a fresh CI dispatch for its new SHA is pending. U5's connected Today browser proof remains blocked.
**Branch:** `feat/m3-4-inventario-porciones`, based on `origin/main` at `52dd9fd45b759677fe996a6c477951acd363733a`.

## Local work units

| Slice | Commit | Scope | Changed lines |
|---|---|---|---:|
| U1 | `5eae3ae804ac324e9eca4d4fdd424acf69a05c22` | Quantitative Today availability details | 248 |
| U2 | `b21b81c870ff43d34636ef05825ade1843aa3d2e` | Explicit target portions and scaling | 346 |
| U3 | `ec83076c56ea27c4c3328e7a81174d91e483db91` | Structured quantity provenance | 286 |
| U4 | `f151295461235590cae9f1ef7c3dc017d9d612d9` | Ephemeral user confirmation of current quantities | 306 |
| **Total** | | Four focused, dependent work units | **1,186** |

Each code work unit is below 400 changed lines; the current U4-plus-readiness delta from U3 is 361 changed lines, within the review budget. Owner selected **Stacked PRs to main**, in order U1 → U2 → U3 → U4; later units build on earlier Today UI/API work. Issue #52 is OPEN with `status:approved` and `type:feature`, and authorizes M3.4 development/PRs only—not merge or production. Published chain (each PR is Draft, links #52, and has exactly one `type:feature` label): #53 U1 `feat/m3-4-u1-availability` → `main` (https://github.com/yabreu65/cocinacore/pull/53); #54 U2 `feat/m3-4-u2-portions` → U1 (https://github.com/yabreu65/cocinacore/pull/54); #55 U3 `feat/m3-4-u3-provenance` → U2 (https://github.com/yabreu65/cocinacore/pull/55); #56 U4 `feat/m3-4-u4-confirmation` → U3 (https://github.com/yabreu65/cocinacore/pull/56). PR #56 also carries this readiness document.

## Verification evidence

- U1: 74 focused Today tests; full suite at that commit 813 passed/8 skipped; TypeScript/build/lint and GGA passed; its exact native review was approved and acknowledged.
- U2: 38 focused tests; full suite at that commit 831 passed/8 skipped; TypeScript/build/targeted ESLint/differential compatibility/GGA passed. Native ASSESS was unassessable due undeclared untracked ODD notes; no native reviewer run.
- U3: 107 focused tests; full suite at that commit 837 passed/8 skipped; TypeScript/build/lint/GGA passed, with one existing lint warning. Native ASSESS was unassessable for the same untracked-note reason; no native reviewer run.
- U4: 24 focused helper/UI tests; current full Vitest 845 passed/8 skipped; TypeScript, production build, and GGA passed. Full lint exited 0 with 0 errors and one existing warning at `frontend/src/next.config.test.ts:6`. Native ASSESS was unassessable because untracked ODD notes require explicit declaration; no candidate or `reviewDue` was returned, and no review transaction was started.
- No production database, migration, acceptance workflow, deployment, or production write was used.

### Hosted CI evidence

| PR | Run | Head SHA | Result |
|---|---:|---|---|
| #53 U1 | [39878747631](https://github.com/yabreu65/cocinacore/actions/runs/39878747631) | `5eae3ae804ac324e9eca4d4fdd424acf69a05c22` | success (`frontend-quality`, `E2E Tests`) |
| #54 U2 | [39879011136](https://github.com/yabreu65/cocinacore/actions/runs/39879011136) | `b21b81c870ff43d34636ef05825ade1843aa3d2e` | success (`frontend-quality`, `E2E Tests`) |
| #55 U3 | [39879014707](https://github.com/yabreu65/cocinacore/actions/runs/39879014707) | `ec83076c56ea27c4c3328e7a81174d91e483db91` | failure: `frontend-quality` passed; E2E failed in `e2e/specs/pdfjs-upload-compat.spec.ts:78` because `getByLabel('Título del libro global')` resolves two inputs (strict-mode violation); 37 passed, 2 skipped |
| #56 U4 (before this doc update) | [39879018320](https://github.com/yabreu65/cocinacore/actions/runs/39879018320) | `0bf0daf8fcbf0ef858ce3d70215bee5f48e014ed` | success (`frontend-quality`, `E2E Tests`); this evidence-only change creates a new head requiring a fresh CI run |

All runs used hosted ephemeral Postgres/Redis; production workflows were not invoked. The connected Today synthetic-account test is skipped in these runs because the workflow does not set `COCINACORE_ISOLATED_E2E=1`; green E2E jobs do not close U5.

## U5 browser proof — blocked

The React component tests exercise explicit confirmation, edits revoking confirmation, confirmed zero, duplicate ingredients, and unknown/estimated quantities. The regular Playwright configuration starts a provider server on port 4319 and an app server on port 4320, validates local E2E targets, and the connected Today journey creates a synthetic account/profile behind `COCINACORE_ISOLATED_E2E=1`. Local targets are unavailable: the existing Docker resources on 5433/5434/6379/6380 are original/BuildingOS and forbidden; E2E ports 5435/6381 are not running. Do not provision, clone, migrate, reset, or touch those databases.

Static CI review found a safe hosted-runner path: `.github/workflows/ci.yml` creates ephemeral GitHub Actions Postgres/Redis services, runs migrations/bootstrap only on that runner, and runs Playwright there. It does not connect to local or production services. The connected Today synthetic-account test is skipped by the current workflow because `COCINACORE_ISOLATED_E2E` is not set, so CI will not by itself close the specific U5 browser-proof gap. The deploy, production migration, and production acceptance workflows are separate `workflow_dispatch` workflows gated to `main`; a CI dispatch does not invoke them.

The PR workflow trigger filters `pull_request` to base `main`; therefore #53 received automatic CI and #54–#56 used explicit `workflow_dispatch` on exact branch refs. Results and exact SHAs are recorded above. #55's E2E failure is outside the U3 changed paths and remains an unrelated repository check failure; no out-of-scope fix or retry is included.

## Release gates still required

- Resolve the isolated local Playwright target before claiming the full U5 browser proof; do not use the original/BuildingOS Docker resources.
- The four stacked Draft PRs exist under approved issue #52; #53 targets `main`, later PRs target their immediate parent branches. Each is below 400 changed lines and has exactly one `type:feature` label.
- Safe hosted CI was run on all four exact PR heads. #53, #54, and the pre-document-update #56 heads passed; #55 failed its unrelated PDF.js E2E locator. The documentation-only change in this PR creates a new #56 head and requires one fresh CI dispatch; record that result in the PR and ODD without another readiness-doc rewrite.
- PR publication is complete; no PR is merged. No production action is authorized.
- Before any future production work, separately authorize and verify backup, migration ledger, acceptance, cleanup, and deployment gates. No merge, migration, production acceptance/write, or deployment is authorized by this draft.

## Current non-goals

No M4 predictive work; no M3.3 planning/guided cooking/consumption/reconciliation; no database migration; no merge, production acceptance, or deployment.
