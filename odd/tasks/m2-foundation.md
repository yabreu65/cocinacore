# M2.0 — Mainline foundation

## Objective

Start META 2 from the exact production-certified `origin/main` baseline and make the developer foundation reproducible before product work begins.

M2.0 is intentionally small. It does not add M2 product behavior.

## Starting point

- Base: `origin/main` at `75fd5bd5e7bcce1581962447cf66793765d0c2fc`.
- Production M1 is certified.
- Worktree: `/Users/yoryiabreu/proyectos/cocinacore-m2-foundation`.
- Branch: `feat/m2-foundation`.
- The pre-existing CocinaCore worktree remains untouched with its own local changes.
- ODD only; no SDD/OpenSpec.
- No production mutation or deployment is part of M2.0.

## Decisions

1. Pin the developer Node selection to `22.22.3` with a root `.nvmrc`.
2. Keep historical M1 ODD records unchanged even when they truthfully mention Node 20.
3. Active documentation must describe Node `22.22.3` as the local reference, aligned with CI and production.
4. Engineering gates must use the lockfile-installed TypeScript binary directly instead of `npx`.
5. The only existing ESLint warning is an internal Next.js navigation warning in `frontend/src/app/app/page.tsx`; replace `window.location.href` with client router navigation without changing logout semantics.
6. Do not change dependencies, database schema, migrations, infrastructure, or M1 production contracts.
7. Local npm installation drift is workstation state, not a source change: this work must not mutate the user's NVM/global npm installation.

## RED / GREEN

- RED: `eslint . --max-warnings=0` fails on the existing `@next/next/no-location-assign-relative-destination` warning.
- GREEN: after the focused navigation fix, the same command must pass with zero warnings.

## Baseline evidence

- Node: `v22.22.3`.
- Vitest: `4.1.11`.
- ESLint: `9.39.4`.
- TypeScript: `5.9.3`.
- Next.js: `16.3.8`.
- Coverage baseline: 49 files / 414 tests PASS.
- Coverage summary: statements 81.26%, branches 74.46%, functions 86.49%, lines 83.52%.
- Typecheck: PASS.
- Build: PASS, 52 routes/pages generated.
- Baseline lint: 0 errors / 1 warning.
- Initial build attempt with an external `node_modules` symlink failed only because Turbopack rejects a symlink outside the project filesystem root; a local copy-on-write dependency tree with identical package/lock hashes produced a successful build.

## Acceptance criteria

- [x] Worktree remains based on the exact certified M1 production mainline.
- [x] `.nvmrc` pins `22.22.3`.
- [x] README documents the exact Node reference and direct local TypeScript binary.
- [x] Historical ODD evidence is not rewritten.
- [x] ESLint passes with `--max-warnings=0`.
- [x] Full Vitest coverage passes.
- [x] TypeScript passes.
- [x] Production build passes.
- [x] `git diff --check` passes.
- [x] No dependency, lockfile, migration, DB, Docker, or production changes.
- [x] Generated local test/build artifacts are removed before closure.
- [x] Final worktree diff contains only the intended M2.0 foundation files.

## Final local verification

- Strict lint GREEN: 0 errors / 0 warnings with `--max-warnings=0`.
- Vitest coverage: 49 files / 414 tests PASS; statements 81.26%, branches 74.46%, functions 86.49%, lines 83.52%.
- TypeScript: PASS.
- Next.js production build: PASS, 52 routes/pages.
- `git diff --check`: PASS.
- `frontend/package.json` SHA-256 remains `ac77a0a39cf53bf2829879dfb14918dc08a07e8a29be0ac3864ab4a1a2126813`.
- `frontend/package-lock.json` SHA-256 remains `00caff2efeca12c1d28e436c703e8b3db95e7a90610edc11612c173ba4364e4d`.
- Generated `.next`, coverage, Playwright/test-result outputs were removed after verification.
- Production was not accessed or modified for M2.0.

## Next sequence after M2.0

- M2.1 — real culinary profile: preferences, disliked foods, allergies/restrictions, goals, favorite cuisines, cooking level, habitual available time, and household members.
- M2.2 — “¿Qué cocino hoy?”: automatically present 3–5 choices derived from real inventory, expiry, culinary profile, available time, history, meal plan and trusted RAG; one action opens the recipe.

M2.1 and M2.2 are not implemented in this task.
