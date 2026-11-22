# CocinaCore Bistró — UX household final: 20 routes, single acceptance

## Decision and scope
- User explicitly requested one final review for the full set of 20 routes rather than per-screen approvals.
- Screens 1–5 were independently approved and have PRs #143, #144, #145, #146, #147.
- This candidate is a single local branch, feat/cc-ux-remaining-15-mobile-first, based on the tested History branch (current parent a01a3add8ecc48b0f2db0cb24187b4e3826c5fd0).
- No push, PR, merge, Docker builds, migrations, service restarts or deployments are authorized by this review task.

## Route inventory — 16 real views
1. /app — Inicio (PR #143)
2. /recipes — Mis recetas (PR #144)
3. /recipes/search — Asistente (PR #145)
4. /recipes/[id] — Detalle (PR #146)
5. /recipes/history — Historial (PR #147)
6. /recipes/inventory — Inventario (visual update)
7. /meal-planner — Planificador (visual update)
8. /shopping-list — Lista de compras (visual update)
9. /profile — Perfil culinario (visual update)
10. /onboarding — Primera experiencia (visual update)
11. /billing — Mi plan (visual update)
12. /library — Biblioteca (visual update)
13. /app/premium — Premium Board (visual update, feature explicitly in reconstruction)
14. /app/premium/[id] — Detalle Premium (visual update, feature explicitly in reconstruction)
15. /app/cooking-intent — Vista de preparación (visual update, read-only)
16. /members — Accesos y miembros (visual update, read-only)

## Four legacy routes, not additional screens
17. /dashboard redirects to /app.
18. /premium redirects to /app/premium.
19. /premium/[recipeId] redirects to /app/premium/[id].
20. /recipes/rating redirects to /recipes/history.
Do not create duplicate screens, change redirects or suggest these legacy URLs have their own UI.

## UX changes, strictly presentational
- Brand system kept: Bistró green, champagne accents, burgundy primary buttons where already used; mobile-first spacing and CTA hierarchy.
- Inventory: Bistró header, better add-ingredient CTA and separation of summary, currency and ingredients. Units, quantities, cost, stock/expiry logic, mutation guards and all editable fields untouched.
- Planner: clear hero; fields grouped on desktop; generated menu region visually separated. Existing label "Menú generado" retained to satisfy source compatibility test. All menu confirmation, amounts, schedule and inventory calculations preserved.
- Shopping: header and form emphasize action; long explanation is under an optional accessible details disclosure without changing quantities or transfer action.
- Profile: prominent household context; all allergy/dietary controls, warnings, household members and save flow preserved.
- Onboarding: adds informative mobile introduction; step navigation, choices and persistence untouched.
- Billing: plan/trial information only; no nonexistent checkout or plan changes added.
- Library: read-only PDFs and books; no invented upload/edit capabilities.
- Premium Board and detail: honest reconstruction status; no invented recipes, recommendations or premium activation.
- Preparation: preview sections and quantities reorganized, no cooking execution or inventory mutation.
- Members: role and existing accesses visibly presented; no new user invitations or deletion functionality.

## Visual comparison and quality
- Complete interactive gallery at http://127.0.0.1:4397/revision-20.html on authorized Mac loopback only.
- Gallery covers all 20 exact routes. Legacy redirect routes display the existing destination design explicitly, not fabricated pages.
- Screens 6–16: 44 real React/Next screenshots (11 original + 11 proposed, each at 390×844 mobile and 1440×900 desktop), plus first-viewport mobile crops; all API responses are identical synthetic fixtures.
- Screens 1–5 reuse earlier approved Playwright screenshots. Every referenced image (96 distinct files) confirmed to exist.
- Both remaining manifests report 22/22 captures HTTP 200 with 0 runtime page errors, 0 horizontal overflow, 0 unexpected API requests.
- A second independent Playwright test of the gallery itself passed 20/20 routes, links, search and device selectors at desktop and mobile sizes; no JS errors or overflow.
- Temporary Next dev routes under /ux-20, visual-only session override and database query fixtures are REMOVED from both worktrees. Both dev servers closed and generated .next/dev caches removed.
- The source branch only contains actual 11 view changes, a browser spec and this documentary record.
- TypeScript and ESLint of all 11 changed routes plus new browser spec: PASS. Final full Vitest: 179 files passed, 19 skipped; 2,277 tests passed, 123 skipped, zero failures. The source-compatibility test requiring the unchanged "Menú generado" heading passed after preserving that label.
- Browser E2E spec frontend/e2e/specs/household-remaining-mobile-ux.spec.ts: statically verified, to run in CI if the candidate is published after approval; no real API mutations performed.
- No private user data, real API model calls, edits to actual inventory, or service changes.

## Review boundary
The 20-route gallery must be reviewed and owner approval received BEFORE publication or merge of the remaining batch. The first five PRs remain independent and are not automatically merged.
