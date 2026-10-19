# M3.2 U3 — Recipe library UI

## Goal
Build the responsive persistent recipe library UI over the existing U2 API routes without changing unrelated routes or starting U4.

## Constraints
- Work only in `feat/m3-2-recetario-inteligente`.
- Preserve `.atl/skill-registry.md`, `.codegraph/`, unrelated U0 task changes, and M1–M3.1 behavior.
- No local PostgreSQL 5433, production, Redis, deploy, push, or U4.
- Reuse the existing CocinaCore visual language, auth/session behavior, `safeFetch`, and API contracts.
- Do not invent unit conversions; scale only structured numeric quantities with recognized units.
- The editor represents steps/notes through the existing `instructions` field only; no hidden serialization or API/schema extension.

## Planned scope
- Recipe library at `/recipes` with search, active/archived filter, category/tag chips, loading/empty/error states, and duplicate warnings.
- Manual create/edit editor for title/category/tags, ingredients, servings, instructions/steps, and notes-compatible content.
- Detail view with current version, scaled servings preview, version history, restore-as-new-version, archive/unarchive.
- Accessible controls, responsive layout, keyboard/focus states, and explicit non-destructive feedback.

## Tasks
- [x] Add UI DTO/fetch/scale helpers and reusable recipe components.
- [x] Build library, detail, editor, version history, and archive interactions.
- [x] Add focused UI tests and run TypeScript/lint/contract checks.
- [x] Commit validated U3 work units and record SHAs.

## Acceptance criteria
- UI consumes only the existing `/api/recipes` routes and never sends tenant/user ownership fields.
- Loading, empty, validation, API error, duplicate-warning, archive, restore, and optimistic/concurrency states are visible and safe.
- Portion scaling changes only numeric structured ingredient quantities with recognized units; textual/unknown quantities remain unchanged with no invented conversion.
- Existing recipe history/search and M1–M3.1 routes remain compatible.

## Evidence
- U2 commits: `aea0918`, `f6670ec`, `dfbb8da`, `0b46d46`.
- API contracts inspected before implementation: `/api/recipes`, `/api/recipes/:id`, versions, restore, archive.

## Validation evidence
- `cd frontend && npm test -- --run src/app/recipes/recipe-ui.test.ts` — 4 tests passed.
- `cd frontend && npx tsc --noEmit` — passed.
- `cd frontend && npx eslint src/app/recipes/page.tsx src/app/recipes/RecipeLibraryClient.tsx 'src/app/recipes/[id]/page.tsx' 'src/app/recipes/[id]/RecipeDetailClient.tsx' src/app/recipes/recipe-ui.ts src/app/recipes/recipe-ui.test.ts src/app/page.tsx` — passed.
- `git diff --check` — passed.
- `bash scripts/tests/test-persistent-recipe-api-contract.sh` — passed.
- No DB/Redis, production, deploy, push, or U4 actions were used.

## Commit evidence
- `11ad656 feat(recipes): add persistent recipe library UI`
