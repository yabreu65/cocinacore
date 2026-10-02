# M1.5.3 — Shopping List UI (ODD)

## Objective
Build the authenticated user-facing `/shopping-list` page using the existing PostgreSQL-backed Shopping List CRUD APIs. Let a user view pending and purchased rows, manually add rows, toggle status, and deliberately delete rows. Keep Planner-confirmed `meal-plan:<uuid>` rows visible without exposing the UUID. Never mutate inventory or add another persistence path.

## Starting state
- Branch: `feature/meta1-m1-2-meal-planner-contract`
- Base HEAD: `4c073ca8b915da54ba2f23360f27836b397ea4c9`
- Existing unrelated worktree artifacts: `M .atl/skill-registry.md`, `?? .codegraph/`; preserve and exclude from commits.
- Existing `/api/shopping-list` GET/POST and `/api/shopping-list/[id]` PATCH/DELETE are authenticated and scoped by server-derived tenant+user. DTO fields are `id`, `source`, `ingredient_name`, `quantity`, `status`, `created_at`, `updated_at`.
- Playwright has authenticated API CRUD coverage in `frontend/e2e/specs/shopping-list-connected.spec.ts`; project uses Vitest and has no React Testing Library dependency or page-level Vitest examples.

## Page UX contract
- Spanish page title “Lista de compras”, back link to `/app`, clear loading and controlled error states.
- Show pending and purchased sections with counts and required empty states; if the whole list is empty, guide the user to add manually or from Planner.
- Show ingredient, optional quantity, textual status, and human-readable provenance: `manual` → “Agregado manualmente”; `meal-plan:*` → “Desde el planificador”. Never show raw plan UUID or ownership identifiers.
- Manual form requires ingredient name, accepts optional quantity, sends only `{ ingredientName, quantity, source: "manual" }`, and resets only after persisted success.
- Status toggles PATCH only `{ status }`; update visible state only after the server response succeeds. Serialize/disable mutation controls to prevent duplicate rapid actions.
- Delete applies to either status, requires deliberate confirmation, and removes only the successfully deleted row.
- Responsive, readable controls and touch targets; use existing CocinaCore palette/type/card conventions and semantic buttons/labels/status text.
- Page state stays local; no localStorage, invented rows, global state, inventory calls, or second shopping persistence path.

## Navigation and auth decisions
- Add a “Compras” dashboard sidebar link to `/shopping-list` with existing `lucide-react` icon.
- Add `/shopping-list` to protected middleware prefixes and cover anonymous redirect through the established login flow; no second auth layer.
- Preserve existing dashboard behavior and sidebar structure; no dashboard API/card redesign.
- Shared `injectAuth` supports signup-disabled calls, records cached-cookie provenance, and fails closed if either explicit E2E user credential variable is configured. Signup remains available only when no user credential is configured or a caller explicitly opts in with `allowSignup: true`.
- Connected UI auth uses `allowSignup: false` and derives user/tenant only through `/api/profile`.

## Mutation, ownership, and side-effect decisions
- Reuse existing API contracts exactly: GET all items; POST manual item; PATCH pending↔purchased; DELETE by row ID.
- Do not send tenant/user IDs; API remains source of authority for ownership and DTO response.
- No optimistic success: use returned persisted item on PATCH/POST, and remove an item only after successful DELETE.
- Purchased means only `shopping_list_items.status = purchased`. Never call inventory APIs or change stock.
- No schema/migration/backend redesign, premium recipe support, Gemini, or Planner confirmation changes absent a demonstrated regression.

## Test strategy
- Strict TDD: active Gentle AI skill requires RED/GREEN/TRIANGULATE/REFACTOR when tests exist. Unit/API runner: `cd frontend && npm test -- <paths>`; browser runner: `cd frontend && npm run test:e2e -- <spec> --project=chromium`.
- Focused UI coverage uses API-mocked Playwright cases; connected coverage verifies durable behavior with the pre-provisioned user and PostgreSQL test environment.
- Connected E2Es seed uniquely named rows scoped to that user's tenant/user, verify ownership/source, and clean only captured IDs in `finally`. Do not bootstrap/delete identities or tenants.

## Tasks
1. [x] Implement the Shopping List page and focused UI behavior coverage, including long-name visibility.
2. [x] Add dashboard “Compras” navigation, protect `/shopping-list`, and extend anonymous auth redirect coverage.
3. [x] Add connected UI+PostgreSQL Shopping List E2E for seed/create/status/delete/reload/ownership/provenance/exact cleanup.
4. [x] Complete the final evidence/commit record. Verification, Guardian Angel review, local ODD commits, and generated-artifact cleanup are complete. No hook bypass, push, PR, staging, or deploy occurred.

## Root-cause evidence
- One controlled diagnostic run used the official standalone Playwright runner. It recorded one Planner heading in each phase; `isVisible()` was false while computed `display:block`, `visibility:visible`, and `opacity:1`. The heading rectangle had width 0 and height 1632. After reload it was at y=324 within the viewport but remained width 0, so viewport position did not explain the failure.
- The heading’s `.min-w-0` text cell was 0×1792 while its article was 846×1826 and its parent section was 846px wide. No hidden/aria-hidden/inert ancestor or active animation was found. Results were unchanged at initial load, +250 ms, +1000 ms, after API mutation, and after reload. Existing and freshly created Playwright locators behaved identically; stale locator, delayed rendering, transition, and collapsed ancestor were not the cause.
- Captured HTML showed a card using `sm:grid-cols-[1fr_auto]` with a shrinkable text cell and a flex action group containing a long `Eliminar <ingredient>` label. The unbounded auto action track consumed the available width and collapsed the heading cell. Fixed this with bounded shrink-safe grid tracks and wrapping action controls. Added a mocked long-name regression checking card/heading visibility and nonzero heading width. All temporary diagnostic code/logging was removed.
- The first post-fix connected run exposed a separate test race: Playwright `click()` returned before the asynchronous PATCH completed, so the immediate PostgreSQL assertion read the old `purchased` value. The test now waits for both visible status labels to reflect the completed PATCH before querying PostgreSQL. No API/product behavior change was required.

## Verification results
- Controlled diagnostic: 1 connected test passed with temporary visibility assertions suppressed solely to collect evidence; exact fixture cleanup succeeded.
- Connected Shopping List UI + PostgreSQL: first post-fix run failed at the persisted status assertion due to the asynchronous test race above; after adding status waits, **1 passed** and cleanup verified all owned fixture IDs absent within the profile-derived user+tenant scope.
- Focused Shopping List UI: **5 passed / 0 failed**, including the long-name regression.
- Auth helper edge case + anonymous Shopping List redirect: **2 passed / 0 failed**. Coverage confirms email-only/password-only configured credentials disable signup fallback; redirect remains protected.
- M1.5.2 connected API regression: **1 passed / 0 failed** after fixing profile tenant extraction to `user.tenant.tenantId`; cleanup fallback scopes by item ID + tenant + user.
- Final full Playwright: **25 passed / 0 failed / 2 skipped**. Connected output reported the deliberate UI-created row deletion; the suite did not independently report cleanup for every fixture.
- M1.5.2 focused API/UI unit regressions: **6 files / 63 tests passed**.
- Final Node 20.20.2 gates, using isolated npm-exec runtime/cache (not installed globally): `npm ci` passed; `npm test` **43 files / 376 tests passed**; `npx tsc --noEmit --tsBuildInfoFile .next/tsconfig.tsbuildinfo` passed; lint passed; build passed (51 static pages); `git diff --check` passed. The cache was removed. npm reported 16 audit advisories and a `pdfjs-dist` Node>=22.13 engine warning; neither stopped the gates.

## Progress and cleanup
- No schema or migration changes. No account/tenant creation/deletion, inventory/plan mutation, Redis changes, rate-limit changes, push, PR, staging, production, or M1.5.4 work.
- Generated `frontend/test-results` and `frontend/playwright-report` were removed after evidence capture and again after the final focused rerun; the isolated Node 20 cache was removed. No `/private/tmp/cocinacore-*` paths remain.
- `.atl/skill-registry.md` and `.codegraph/` remain preserved unrelated work and must be excluded from commits.
- Guardian Angel blocker resolution: GGA suppresses provider stdout/stderr, so a direct Codex diagnostic was used to expose the real failure. The prior Codex path had exhausted the GPT-5.6-Codex-Mini usage allowance. `gpt-5.6-sol` was verified independently (`codex exec` RC 0) and used temporarily as the Codex default while the mandatory hook ran; the hook itself, GGA policy, and retry/fallback logic were not changed and no bypass was used. Guardian Angel then reviewed each work unit through the normal `git commit` path.
- Guardian Angel rejected the integration work unit once for valid findings: DB assertions were not scoped strongly enough to exact tenant+user, Planner provenance used a global locator that could become ambiguous, and middleware prefix matching lacked segment boundaries. Those issues were corrected; a single focused auth/API/UI Playwright rerun passed **8/8** before retrying the commit. A pre-existing `latestPdfs: unknown[]` warning and a Node 22.11/Vitest startup incompatibility were not expanded into unrelated product work; the second Codex review correctly recognized the known-good Node 20 gate and passed the reviewed unit.
- Local work-unit commits: `7aec6d8b86dd6df2a266e880139e4cc511d93bd7` (`feat(shopping-list): add persisted shopping page`) and `dea77309183e837032518523dd3953fede21d689` (`test(shopping-list): connect authenticated shopping flow`). `.atl/skill-registry.md` and `.codegraph/` remain preserved unrelated work and are excluded.
- M1.5.3 status: **CLOSED locally** after the final documentation commit records this evidence. No push, PR, staging, production mutation, or M1.5.4 work was performed.

## Non-goals
M1.5.4, inventory synchronization, receipt/barcode scanning, purchase analytics, collaboration, notifications/WhatsApp, AI/pricing/store integrations, offline mode, schema changes, push, PR, or deployment.
