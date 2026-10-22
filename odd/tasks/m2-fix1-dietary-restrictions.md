# M2-FIX1 — Dietary restriction categories
ODD feature record for a conservative, deterministic correction to M2 ingredient restriction filtering.
Branch: `fix/m2-dietary-restrictions` from `origin/main` (`e6f62548c5955a37e0c57a7b2d17468909c77457`). No M3.3 U1, production, DB, or migration work.

## Specs

### S1 — Scope and compatibility
> “resolver solo la interpretación determinista y conservadora de restricciones dietéticas por categoría, mantener el filtrado existente de alérgenos e ingredientes explícitos, y evitar que Today / plan / generación den una receta claramente incompatible como válida.”

### S2 — Minimum category mappings
> “Mapear al menos Vegano (pollo, carnes, pescado, lácteos, huevo), Sin TACC (trigo, cebada, centeno, maltas que contengan gluten), Sin lactosa (leche convencional y derivados con lactosa).”

### S3 — Uncertainty must not imply safety
> “No inventar certeza de ausencia de contaminación ni convertir datos incompletos en seguro.”

### S4 — Deterministic enforcement across existing routes
> “Mantener compatibilidad; no confiar en IA para seguridad.”
>
> “Las nuevas políticas deben atravesar Today, receta generada y plan sin mutaciones implícitas.”

### S5 — Required verification
> “Pruebas: negativas y positivas, casos ambiguos que se marquen desconocidos/revisión, variantes acentuadas/terminología común, sin falsos positivos obvios, tests de contrato y regresión de todas las rutas, lint y TypeScript.”

### S6 — Delivery and exclusions
> “No alterar PostgreSQL, Redis ni datos productivos. Ejecutar solo tests locales sin efectos destructivos.”
>
> “Abrir PR hacia main solo después de commit y pruebas PASS, vincular issues #10/#13 con 'Refs #10' y 'Refs #13', no cerrarlos. Comprobar CI; NO hacer merge ni desplegar sin decisión PM.”
>
> “No ampliar a los errores de perfil legado ni historial.”
>
> “no worktrees.”

## Tasks
- T1 [done] — S1-S6 — Preflight, branch and evidence audit — route: read-only/local Git + GitHub reads — commit: N/A (no implementation).
- T2 [done] — S1-S5 — Add dedicated regression proofs for reviewer claims: `huevos` under Vegano is conflict; `gluten vital` under Sin TACC conflicts; `vital wheat gluten` remains a conflict — route: helper unit tests — commit: pending (same behavior work unit).
- T3 [done] — S1-S4 — Add the specific `gluten vital` phrase to the gluten-containing ingredient vocabulary, without generalized matching — route: `frontend/src/lib/recipes/structured-ingredients.ts` and focused tests — commit: pending (same behavior work unit).
- T4 [in progress] — S3-S5 — Run focused route/full tests, lint, typecheck, differential regression checks, and a fresh independent review — route: local-only verification plus native RDD — commit: pending. Focused/full/lint/TS and differential checks pass after the bounded correction; only fresh independent review remains. The predecessor was audited-abandoned; this ODD record is stabilized before the new candidate review. New review must not reuse abandoned verdicts/captures.
- T5 [pending] — S6 — Commit the single reviewed work unit, open PR with non-closing `Refs #10` and `Refs #13`, and verify CI without merge/deploy — route: Git/GitHub PR — commit: pending.
- T6 [dropped] — S6 — Recover the predecessor by `scope_changed` — route: audited `gentle-ai review recover` — not eligible; one complete PM-authorized attempt returned `native-recovery-status-mismatch`, mutation false. Superseded by T7; no retry.
- T7 [done] — S6 — Record the one authorized native disposition of the blocked predecessor — route: `gentle-ai review abandon`, `operator_disposition`, actor PM — native record committed; predecessor and findings preserved in quarantine; no implementation commit.

## Log

### L1 — Original user request (verbatim)
> PM COCINACORE: Lee íntegramente /tmp/cocinacore-m2-fix1-prompt-20261021.md y EJECUTA AHORA la misión M2-FIX1 conforme a todas sus instrucciones. Debes trabajar de forma visible en esta misma sesión y reportar COCINACORE_M2_FIX1_RESULT al finalizar. No abras ventanas ni sesiones nuevas y no toques la rama M3.3 salvo para salir de ella limpiamente mediante Git.

### L2 — Audited evidence
- `feat/m3-3-cocina-autonoma` remains at `4508e91`; that commit contains only the three M3.3 U0 documents. Worktree is clean. `origin/main` is `e6f62548c5955a37e0c57a7b2d17468909c77457`; two existing stashes are preserved. New branch `fix/m2-dietary-restrictions` is based on `origin/main`.
- PR #11 Codex inline P1 says persisted `avoid` values include `Vegano`, `Sin TACC`, and `Sin lactosa`, but the shared matcher only does lexical phrase matching. Issue #10's 2026-10-21 PM reconciliation independently reproduced chicken/Vegano, wheat flour/Sin TACC, and milk/Sin lactosa as false.
- Shared matcher callers cover Today's provider ranking and saved/history candidates, recipe generation including cache validation, and generated/stored meal-plan checks. Category interpretation at the shared pure helper can protect all these existing call paths without API or persistence changes.
- No production, PostgreSQL, Redis, or migration operation is in scope. Keep issue #10/#13 open; PR body must use their requested non-closing `Refs` references even though the generic PR template says `Closes #N`.

### L3 — RED test evidence
- Added three category failure cases (pollo/Vegano, harina de trigo/Sin TACC, leche convencional/Sin lactosa), explicit safe-positive and ambiguous/review expectations, plus endpoint tests for Today, recipe generation, and meal-plan.
- Initial focused command `npm --prefix frontend test -- src/lib/recipes/structured-ingredients.test.ts src/app/api/today/route.test.ts src/app/api/recipe-generate/route.test.ts src/app/api/meal-plan/route.test.ts` returned 1: 13 failing assertions across 4 suites (10 helper contract cases and 3 route regressions), 117 passing. Existing explicit allergen behavior remains covered by the same suites.
- First implementation GREEN found and corrected a generic `harina` false positive against explicit `harina de maíz`. The focused command passed 4 files/147 tests before a second test expansion. Added further family aliases, ambiguous `crema`, cached-recipe and saved-plan retrieval cases; this latest edit set revealed one compatibility regression and remains in progress.

### L4 — Preserve explicit restriction semantics
- A focused regression showed that interpreting bare `Gluten` as a gluten-free diet category rejected a canonical meal plan that previously passed. Keep bare `Gluten` and `Lactosa` as literal restrictions; only explicit dietary labels such as `Sin TACC`, `Sin gluten`, `Sin lactosa`, or `Libre de lactosa` opt into category semantics. This preserves the distinction required by S1/S4.
- The broad aliases were removed and a regression test was added to preserve literal handling of bare `Gluten`/`Lactosa`; the focused command passed 4 files/151 tests.
- During diff review, early plant-alternative returns were suspected to hide incompatible ingredients in composite text. RED was confirmed by two unit cases: `leche de almendras con pollo` under Vegano and `leche de almendras con leche condensada` under Sin lactosa incorrectly returned clear (2 failed; 37 passed). Token-removal implementation then passed unit 39/39 and focused 4 files/153 tests.
- A final S2 audit found missing checks: `lácteos` under vegan/lactose-free, and explicitly gluten-containing malt. Strengthened tests require `malta con gluten` to return `status: conflict`. RED: 3 failures (lácteos/Vegano, malta con gluten/review instead of conflict, lácteos/Sin lactosa); 39 unit tests passed.
- Implementation now adds plural dairy to vegan conflicts, generic dairy names to lactose review, and explicit gluten-containing-malt phrases to TACC conflicts. Unit GREEN: 42/42; focused route/helper GREEN: 4 files/156 tests.
- Further diff review found an early-clear risk in gluten-free alternatives. RED confirmed two cases: `trigo sarraceno con trigo` and `malta de arroz con cebada` incorrectly returned clear (2 failed; 42 unit tests passed). The implementation now removes recognized gluten-free ingredient phrases before scanning remaining tokens. Unit GREEN: 44/44; focused 4 files/158 tests.
- Another readback found missing/empty ingredient lists return `clear` under an active category. RED confirmed `assessIngredientRestrictions([], ['Sin TACC'])` incorrectly returned clear (1 failed; 44 passed). Implementation now returns `status: review` for empty lists or token-empty names when a category restriction is active; unit GREEN was 45/45 and focused route/helper GREEN 4 files/159 before the next priority readback.
- A final priority readback noticed that empty/blank data returned `review` before remaining ingredients were examined. RED confirmed `['', 'pollo']` under Vegano returns review instead of conflict (1 failing test; 44 passed). The implementation now remembers incomplete-data review while continuing category scans, so a known conflict takes precedence. Unit GREEN: 45/45; focused route/helper GREEN: 4 files/159 tests.
- Full frontend suite GREEN after the lint-only `let`→`const` correction: 81 files/771 tests passed, 3 files/8 tests skipped. Lint reports 0 errors and one unrelated `_options` warning in `src/next.config.test.ts`; TypeScript passes with `npm --prefix frontend exec -- tsc --noEmit -p frontend/tsconfig.json`.
- Differential check copied the four updated tests into a temporary checkout of `origin/main` under the project root and ran them against the previous helper/routes: baseline exit 1, 41 expected category failures/118 passed, including category filtering failures in Today, generation/cache and meal-plan create/retrieval. Current full suite passes 771/771 active tests; no baseline failures appeared outside the newly requested category assertions. Temporary checkout was removed.
- RDD `assess` returned `rddLine: on`, applied the explicit item 2 guard escalation, and requires an independent verifier; native assessment was initially `unassessable` because the ODD task document was undeclared untracked. `inspect` selected that path; ordinary START created medium lineage `review-af36d5684f73c6a5`. After explicit authorization, the three-reviewer group and one provider-refuter run completed. STATUS returned a bounded correction-plan request for `R1-001`, `R3-001`, and `R3-002`, budget 200, target-bound; findings are reproduced in the next log entry.

### L16 — Provider correction findings (verbatim)
- `R1-001`: “A vegan restriction does not reject the common ingredient name “huevos”. The new classifier matches the singular “huevo” as an exact token but not its plural, so it returns clear and allows a clearly vegan-incompatible recipe through the category check.”
- `R3-001`: “A vegan restriction accepts the common ingredient name “huevos” as clear, allowing an egg-containing recipe through the shared route filter despite the requested vegan egg exclusion.”
- `R3-002`: ““Gluten vital” is classified as clear under “Sin TACC”, so a plainly gluten-containing ingredient can be returned as compatible by Today, generation, or meal-plan filtering.”
- The provider permits one bounded correction only. Planned diff lines: 6 (add the two ingredient forms and two regression rows). The correction-plan capture was rejected twice with `collectBinding does not carry one non-empty matching provider lineage and target token`, including after fresh STATUS reoffered the same exact slot. Both rejections report `mutation_performed=false`; do not retry, edit, or restart/reclaim this authority without maintainer repair or explicit operator disposition.

### L17 — Native correction-plan binding blocker
- A second capture using the exact binding from fresh bound STATUS again returned `capture-binding-rejected` and `mutation_performed=false`. Current candidate identity is `sha256:90e5d2fa49428d50e236dbe0777124765809afd68acd1d80d77ed5585ae8982e`, while the authority target remains `sha256:e0ec4aa9c89e6cdfe413813489d1c07468eeb8f803e9b35df823173a09557e29`; status attributes the mismatch to workspace drift after later task-log edits.
- Stop correction work here. The only allowed fix is the provider's bounded correction plan for R1-001/R3-001/R3-002; no source fix, new lineage, abandon, reset, or reclaim until the native binding is repaired or the user makes an explicit authorized disposition.

### L18 — PM recovery authorization and correction plan (verbatim)
> DECISIÓN EXPLÍCITA DEL PM sobre el bloqueo RDD:
> - Autorizar la **recuperación nativa auditada mediante `gentle-ai review recover`** exclusivamente porque el target de la autoridad de revisión `review-af36d5684f73c6a5` cambió tras editar el documento ODD, provocando `capture-binding-rejected` x2 (`mutation_performed=false`). Motivo justificable: `scope_changed` por drift del documento durante review. El sucesor debe incorporar el diff completo, preservar la autoridad predecesora y recibir revisión independiente nueva. No apagar RDD ni saltar revisión; no usar `--no-verify`, `SKIP`, reset o reescritura de stores; no abandonar la revisión anterior. Si `review recover` exige un binding de autorización explícito, constrúyelo exactamente según su contrato nativo con actor `PM` y razón precisa de drift, sin falsear revision/target/receipts. Si el controlador no permite la recuperación legítima, documenta el bloqueo específico y detente, sin mutar fuente.
> - Verifiqué directamente sobre el estado actual: `assessIngredientRestrictions(['huevos'],['Vegano']).status` devuelve `conflict` por normalización `huevos` a `huevo`. Por tanto R1-001 y R3-001 NO se reproducen actualmente; demuestra esto con test dedicado y explicación al verificador, sin introducir un alias innecesario.
> - `assessIngredientRestrictions(['gluten vital'],['Sin TACC']).status` devuelve `clear`: R3-002 es fallo real. Después de un recovery válido, corrígelo con una regla concreta limitada y prueba RED/GREEN de `gluten vital` (y `vital wheat gluten` si aplica). No generalices todos los nombres con `gluten` si rompe compatibilidad literal. Todos los cambios deben quedar dentro del alcance y revisar safe/unknown.
> - Asegura que documentación ODD no cause nuevo drift durante la revisión: documenta el checkpoint antes de iniciar el sucesor, y evita editar el scope congelado entre START/CAPTURE/VALIDATE. Obedece los transitions/resultados nativos; no manipules estado interno.
> - Repite focused 4 suites (último 159/159), full Vitest (último 771 PASS), lint, tsc, y QA diferencial cuando cambies guard. Obtén reviews independientes sin blockers vigentes; testea huevos y gluten vital por separado.
> - Luego commit con hooks/Guardian Angel intactos. Abre PR con `Refs #10` y `Refs #13` sin auto-close, revisa CI. No merge, no despliegue. Si el review falla, informa al PM sin inventar PASS.
> - REPORTA `COCINACORE_M2_FIX1_RESULT` con estado preciso y próxima acción. Trabaja ahora, sin esperar otra confirmación dentro del alcance. Si una herramienta exige autorización distinta a la decisión PM aquí especificada, detente en ese límite.

### L19 — Current reproduction and impact map
- A read-only TypeScript runtime probe against current `structured-ingredients.ts` returned `huevos/Vegano=conflict`, `gluten vital/Sin TACC=clear`, and `vital wheat gluten/Sin TACC=conflict`. No source files were modified.
- CodeGraph impact mapping confirmed the shared classifier's existing callers in Today, recipe generation/cache, and meal-plan flows; the reviewed unit and route tests remain the relevant regression surfaces.

### L20 — Review budget decision
- RDD skill's hard candidate cap is 400 additions plus deletions unless chained or explicitly excepted. The candidate was 479 lines when the user approved an exception up to 480 in L22; subsequent blocker evidence in L23 adds ODD log lines, so this exception no longer covers a future candidate.
- The PM checkpoint requires the recovery successor to contain the full diff. Preserve independent review and do not infer delivery authority. Native recovery did not proceed; exact successor/disposition were not supplied.

### L21 — Initial RDD review-budget exception (verbatim)
> Aprobar excepción de 469 líneas

### L22 — Revised RDD review-budget exception (verbatim)
> Aprobar hasta 480 líneas

### L23 — Native recovery requested missing values; no mutation
- Bound `gentle_review status` remained `correction_required` with authority revision `sha256:13e255a7ef16318ec27650137aeecf781ef4a8001e58e4c41aa0852bbcf3eb17`, authority target `sha256:e0ec4aa9c89e6cdfe413813489d1c07468eeb8f803e9b35df823173a09557e29`, current target `sha256:0b73a494988b193e0304be1c46279bce9881cdcde239f2b364d4062e699fef08`; the only offered transition remained correction-plan collect.
- `gentle_review recover` with known predecessor, revision, actor `PM`, and precise `scope_changed` reason returned `native-input-required`, missing `successorLineage` and `disposition`, with `mutation_performed=false` and `mutation_outcome=none`. The native status did not offer a disposition; no values were invented.
- A separate read-only `inspect` was unrelated and requested intended-untracked selection for the ODD file; no selection, START, recovery, or source mutation followed. The ODD file then documented the new PM recovery instruction before the next attempt.

### L24 — PM native recovery input and budget exception (verbatim)
> Decisión expresa del PM: autoriza intentar UNA VEZ más el procedimiento de recuperación auditada, con los inputs nativos completos. Usa `successorLineage: review-m2-fix1-recovery-20261021` (comprobar primero que no exista) y `disposition: scope_changed`, junto con `predecessorLineage: review-af36d5684f73c6a5`, `expectedPredecessorRevision` literal fresco del status, actor PM, razón 'ODD-document target drift after review START caused rejected correction captures; preserve predecessor and re-review full candidate'. Si `review recover` exige además `maintainerAuthorization`, lee su contrato nativo y construye binding verdadero y exacto, sin inventar tokens. La autoridad anterior se preserva; nueva revisión independiente obligatoria; no bypass, reset, abandono, ni suplantación de un resultado PASS.
>
> La autorización de presupuesto RDD se extiende EXPRESAMENTE hasta **550 líneas sumadas (añadidas y eliminadas) incluyendo el task ODD y el ajuste acotado**, únicamente para esta operación y este control dietético, debido a que la bitácora del mismo invariante creció en los checkpoints. No añadas nuevos módulos ni cambios funcionales de otro alcance. Si supera 550, detente. Anota esta aprobación ANTES del nuevo START/recovery y no edites ese documento otra vez mientras esté congelado para la revisión. La autorización anterior de 480 sigue documentada como antecedente.
>
> Si acepta recovery, continúa inmediatamente con test RED, fix estrecho de `gluten vital`, GREEN, review nuevo, full tests, lint, tsc, commit con Guardian Angel, PR con Refs #10 y Refs #13, CI. Si el controlador responde otra vez BLOCKED por un motivo semántico concreto que no es input faltante, no pruebes variantes indefinidas: conserva archivos, evidencia y presenta `COCINACORE_M2_FIX1_RESULT` al PM. No merge ni deploy.

### L25 — PM authorized native abandonment (verbatim)
> Nueva decisión explícita de PM (operador con autorización delegada del propietario): autorizo **una sola disposición auditada y nativa** de la autoridad defectuosa `review-af36d5684f73c6a5` mediante `gentle-ai review abandon`, con `reason=operator_disposition` y `actor=PM`, SOLO después de comprobar elegibilidad/estado desde autoridad persistida, y generar el binding `gentle-ai.review-abandon-authorization/v2` exacto siguiendo la plantilla nativa del CLI. Este ABANDON NO elimina el código, ni borra defectos/reviews, ni constituye revisión aprobada: únicamente deja registro de la autoridad inutilizable por mismatch. Nunca reescribas stores, no omitas controles, no force-reset, no pases `--no-verify` ni marques findings falsamente resueltos.
>
> Después del abandono auditado exitoso: anota los hallazgos anteriores R1-001/R3-001 ('huevos' Vegano; reproducir que está bloqueado) y R3-002 (`gluten vital` Sin TACC; fallo real). Añade RED tests y corrige acotadamente solo el fallo real. Estabiliza/cierra el registro ODD antes del próximo review START (la excepción PM hasta 550 líneas incluye ODD y las pruebas), y vuelve a iniciar revisión RDD INDEPENDIENTE desde candidato nuevo. No reutilices verdict/captures de la autoridad abandonada. Los tests de rutas, full suite, lint y tsc deben pasar. Obtener aprobación de revisores y Guardian Angel. Crear commit/PR con Refs #10/#13, comprobar CI, SIN MERGE ni DEPLOY. Si falla un control, documenta bloqueo y detente.
>
> `gentle-ai review abandon` sin flags ya mostró formato obligatorio de 8 líneas: no inventes ningún campo: `lineage`, `revision`, `snapshot_identity`, `captured_lens_results`, `findings_present` deben copiarse de la autoridad persistida (`gentle-ai review status --cwd`). No tocar autoridades ajenas. Si la ruta nativa no es elegible, detente; no busques un bypass alternativo.
>
> No nuevas sesiones/ventanas/worktrees ni cambios en M3.3. Trabaja ahora y reporta `COCINACORE_M2_FIX1_RESULT` cuando finalices o haya un bloqueo real.

### L26 — Audited native abandonment record
- Fresh bound status immediately before disposition confirmed `review-af36d5684f73c6a5` at `correction_required`, revision `sha256:13e255a7ef16318ec27650137aeecf781ef4a8001e58e4c41aa0852bbcf3eb17`, current target `sha256:fa79dd14c3ffdbb1829fd71668faf3e1d236090111387e5493d7cfe5485aa572` vs authority target `sha256:e0ec4aa9c89e6cdfe413813489d1c07468eeb8f803e9b35df823173a09557e29`.
- Native `review abandon` committed for reason `operator_disposition`, actor `PM`, at `2026-10-22T00:50:27.675563Z`. Audit record quarantined under `.git/gentle-ai/review-transactions/quarantine/review-af36d5684f73c6a5-1634253204`, source record under `.git/gentle-ai/review-transactions/v2/review-af36d5684f73c6a5`, residue `review-state.json`. Captured lenses `00-review-risk`, `01-review-readability`, `02-review-reliability`; `findings_present=true`; revision/snapshot identity preserved in native audit. No source or code was lost and no review approval was asserted.
- Old verdicts/captures are not reusable. The previous direct probe showed `huevos` already conflicts and `gluten vital` incorrectly cleared; dedicated proofs are in L27.

### L27 — Bounded gluten-vital correction, RED/GREEN
- Added focused unit proofs for `huevos`/Vegano, `gluten vital`/Sin TACC, and existing `vital wheat gluten`/Sin TACC behavior. The focused command `npm --prefix frontend test -- src/lib/recipes/structured-ingredients.test.ts` returned RED: 1 failed (`gluten vital` expected conflict, received clear), 47 passed; egg and vital-wheat assertions passed.
- Added only the specific `gluten vital` phrase to `GLUTEN_CONTAINING_INGREDIENTS`; no generic `gluten` alias or unrelated policy changes. The same focused command returned GREEN: 1 file, 48/48 tests passed. Vite's existing `configLoader: 'native'` warning appeared in both runs.

### L28 — Post-correction verification
- Focused helper+route run: 4 files, 162/162 tests passed. Full Vitest: 81 files/774 passed; 3 files/8 tests skipped. Lint: 0 errors, one existing `_options` warning. `tsc --noEmit -p frontend/tsconfig.json` exited 0.

### L29 — Differential route verification for `gluten vital`
- A temporary scratch copy of `origin/main` and a candidate copy ran identical focused public-handler tests with `gluten vital` under `Sin TACC` for Today provider options, cached recipe retrieval, meal-plan creation, and saved-plan retrieval. Baseline exit 1: four expected rejection failures (110 tests skipped); candidate exit 0: four passed (110 skipped). Candidate statuses and side-effect assertions passed. Temporary scratch tree was removed; committed route sources were unchanged.
- The differential isolates the new classifier phrase: on old code, the four routes returned accepted/success values rather than the expected rejection statuses; with the candidate helper, each path rejected it. Fresh independent native RDD review remains pending.
