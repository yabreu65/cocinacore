# M3.3 U0 — Resumen para el PM

**Estado: listo para revisión; no se declara U0 cerrado.** Trabajo realizado en la rama `feat/m3-3-cocina-autonoma`, commit auditado `e6f62548c5955a37e0c57a7b2d17468909c77457`. No se implementó U1–U6 ni se tocó producción, DB o servicios.

## M3.3_U0_RESULT

- **branch:** `feat/m3-3-cocina-autonoma`
- **base_sha:** `e6f62548c5955a37e0c57a7b2d17468909c77457` (HEAD; `HEAD...origin/main` 0/0 usando refs locales)
- **worktree_status:** los tres documentos U0 están staged. El intento local de commit agotó timeout en el pre-commit Guardian Angel; no hay commit nuevo. El hook dejó `.atl/skill-registry.md` modificado (24 inserciones/31 eliminaciones), fuera de M3.3, unstaged; no se restauró ni incorporó. Stash preexistente no fue restaurado.
- **existing_capabilities:** Today contextual, perfil/restricciones, inventario+movimientos, recetas persistentes con versiones, generación de plan completo, cálculo/confirmación de compras, transferencia comprada→inventario idempotente, confirmación transaccional de comida planificada con skips e idempotencia. Evidencia y clasificación en el dossier.
- **missing_capabilities:** enlace de recomendación→receta persistente→slot individual de planificación; contrato de receta seleccionada/append; disponibilidad/frescura inequívoca; cantidades reales editables y correcciones; preparación paso a paso y recuperación/progreso duradero no identificados. Sustituciones no están modeladas como campos estructurados.
- **architecture_recommendation:** servicio de dominio determinista dentro del backend Next.js; reusar reglas/contexto Today, perfil, recipe repository, plan e inventory projection. Gemini opcional para candidatos, nunca autoridad de restricciones, stock ni escrituras. Separar lecturas de comandos con confirmación, relectura del estado y respuestas idempotentes.
- **api_contract_gaps:** `POST /api/today` devuelve opciones por slot; `POST /api/meal-plan` genera/persiste un menú completo y depende de Gemini; no se encontró un endpoint para adjuntar una receta individual a un slot. Consumo actual recibe plan/día/tipo, no cantidades reales modificadas. Propuestas de contrato y errores/riesgos están en el dossier.
- **database_migrations_needed:** no necesariamente para el caso limitado de comida en un slot de plan ya existente. Probable esquema aditivo si PM requiere comidas standalone, sesiones guiadas durables o correcciones de consumo auditables. Decisión pendiente; no se ejecutó migration ni DB.
- **security_risks:** issue #13 sigue abierto; aceptación funcional de M2 y M3.1 sigue condicional según actas; tenant/user scope y políticas de inventario/RLS requieren confirmación. Otros riesgos: restricciones, inventario desconocido/desactualizado, conversiones, double-decrement/retry, plan conflict, shopping duplicates y pérdida de conexión.
- **ux_state_machine:** idle → loading → recommendations/unknown → recipe_detail → plan_confirmation → planned → shopping_review/confirmation → cooking → consumption_review → consumption_saving → complete; errores/conflictos recuperables vuelven a leer estado antes de reintentar. Ver estados y efectos en el dossier.
- **u1_to_u6_plan:** secuencia y criterios verificables documentados: U1 motor; U2 cantidades/porciones; U3 UX; U4a plan+compras y U4b preparación+consumo; U5 seguridad/regresión/E2E; U6 release/aceptación gated. U4 se divide para limitar tamaño y riesgo.
- **tests_executed:** no se ejecutaron tests/build/lint de aplicación, consultas DB, Redis, proveedor IA, migraciones ni producción. Sí se realizó auditoría estática de fuentes/actas, lectura read-only de los cuatro issues abiertos, explorer bounded, checker de enlaces/citas/whitespace no literal (PASS), `git ls-remote origin refs/heads/main` (SHA coincide con HEAD) y `git status`. `git diff --check` por defecto señala únicamente los dos espacios de hard-break requeridos por el texto original; con `core.whitespace=-blank-at-eol` pasa. El commit intentado expiró durante la revisión pre-commit Guardian Angel; no se reintentó.
- **documents_created:** `odd/tasks/m3-3-u0.md`; `docs/roadmap/m3-3-cocina-autonoma-u0.md` (matriz, contratos, arquitectura, UX, riesgos, plan); este resumen.
- **blockers:** issues #10 (pendientes PR/CI, revisión e integración) y #13 (remediación M2) más aceptación M2/M3.1 condicional son gates de gobernanza para U1/U6; no impiden que el PM revise U0. #3 (identidad DB, open y sin PR) y #39 (signup success/error contradictorios) son riesgos adyacentes que no se deben ampliar a este alcance sin decisión. Además, el commit local no se completó: el Guardian Angel agotó el timeout y modificó `.atl/skill-registry.md`; no se reintentó ni restauró. Ningún estado productivo se revalidó.
- **decisions_required:** plan de cierre de #10/#13; slot existente vs comida standalone y política de reemplazo; inventario compartido por tenant/hogar y frescura; cantidad real editable y correcciones; estructura/persistencia de pasos de cocina; política de envío de contexto a Gemini; si issues adyacentes #3/#39 cambian gates de auth aplicables.
- **recommended_next_action:** PM revise el dossier y resuelva las decisiones anteriores, especialmente el gate M2/#10/#13. Decida si autoriza otro intento de commit después de resolver el timeout del Guardian Angel y cómo disponer del cambio ajeno en `.atl/skill-registry.md`; no se tocó ese archivo. No iniciar U1 hasta aceptación explícita del diseño.

## Alcance verificado

- Inicio: rama correcta, árbol limpio y 0 ahead/behind respecto de `origin/main` según las refs locales. Se respetaron los stashes.
- M2 y M3.1: actas registran aceptación funcional de producción condicional. M3.2 U5/U6: acta declara cerrado. No se conflaron cierres.
- Issues abiertos observados: [#10](https://github.com/yabreu65/cocinacore/issues/10) y [#13](https://github.com/yabreu65/cocinacore/issues/13) directamente relacionados con el gate M2; [#3](https://github.com/yabreu65/cocinacore/issues/3) adyacente a identidad DB; [#39](https://github.com/yabreu65/cocinacore/issues/39) adyacente a signup/auth.
- Dossier distingue hechos, brechas y propuestas con `archivo:líneas`; no se verificó runtime ni estado productivo actual.
- U0 produce documentación y recomendaciones solamente; no cambia comportamiento.

## Revisión del PM

- [ ] Aceptar/rechazar la arquitectura recomendada.
- [ ] Resolver las seis decisiones listadas en `decisions_required`.
- [ ] Confirmar el gate pendiente de M2 y el tratamiento de issue #13.
- [ ] Autorizar U1 en una decisión separada; este informe no autoriza su inicio.

## Cierre técnico PM — decisión posterior al informe de Pi (2026-10-21)

El PM autorizó completar U0 documental y resolver exclusivamente el bloqueo de commit, sin autorizar U1, merge ni despliegue. Los datos anteriores conservan el estado de la entrega original de Pi. Este cierre usa un nuevo commit de documentos y no modifica aplicación, bases de datos ni producción.

**Diseño aprobado como dirección inicial, sujeto a contratos y pruebas de U1–U4:** motor determinista local con IA complementaria no autoritativa; selección por fecha/slot sin reemplazo implícito y posibilidad de iniciar una comida sin menú completo; inventario doméstico compartido sólo con autorización y sin suponer que los datos registrados están completos; cantidades realmente utilizadas editables con correcciones auditables; progreso de cocina reanudable; envío de datos a proveedor externo limitado, transparente y controlable por usuario. Antes de implementar nuevos contratos o tablas se deberá justificar la opción aditiva mínima, su aislamiento tenant y sus pruebas.

**Gates aún abiertos:** #10 y #13 requieren verificación y resolución independiente respecto de M2; #3 y #39 permanecen como bugs adyacentes. La aprobación de la arquitectura **no autoriza U1** hasta decisión explícita del PM sobre el gate M2 y el alcance del primer PR.

**Higiene de commit:** se conservó copia externa del cambio de `.atl/skill-registry.md` generado por el pre-commit anterior; sólo se permite restaurar ese archivo después de verificar la copia y mantener fuera del commit. El texto original del prompt conserva sus palabras y orden; se retiraron únicamente espacios finales de Markdown para que `git diff --check` pase sin excepciones.
