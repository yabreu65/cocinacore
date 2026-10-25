# M3.4 — Inventario y porciones: diagnóstico U0

**Estado:** U0 diagnóstico completado; U1 acotada y autorizada para implementación en `feat/m3-4-inventario-porciones`. No se ejecutaron pruebas, consultas a BD, migraciones, acceptance de producción ni acciones de entrega durante este diagnóstico.

## 1. Resumen

M3.4 debe hacer que la disponibilidad de ingredientes y el escalado de recetas expresen únicamente lo que los datos permiten demostrar. No se debe inferir que el inventario está completo, convertir cantidad o unidad desconocida en cero, ni afirmar `sufficient` sin cantidades comparables.

**Causa de las cuatro opciones `unknown`:** no hay evidencia de que sea un defecto de cálculo. La respuesta de Gemini limita cada ingrediente a texto/nombre (`frontend/src/app/api/today/route.ts:35-76,78-123`); no contiene cantidades requeridas ni unidades. `normalizeRecipeIngredient` convierte un texto sin prefijo cuantitativo en `requiredQuantity: null` y unidad `unknown` (`frontend/src/lib/inventory/recipe-requirements.ts:116-145`). El motor conserva `unknown` si no hay una fila de inventario con nombre equivalente; aun con nombre coincidente, el comparador no puede determinar suficiencia cuando falta cantidad/unidad requerida (`frontend/src/lib/today/local-first-engine.ts:226-247`; `recipe-requirements.ts:258-270`). Además, Today lee una muestra acotada y el modelo no acredita que el inventario esté completo o recientemente verificado (`frontend/src/app/api/today/route.ts:430-462`; `frontend/src/lib/today/context.ts`). Por tanto, cuatro recomendaciones originadas en proveedor sin cantidades son compatibles con el contrato actual y no prueban ni disponibilidad ni ausencia física.

## 2. Comportamiento comprobado en fuente

| Tema | Hecho observado | Implicación |
|---|---|---|
| Today/proveedor | El esquema del proveedor emite ingredientes como strings; su parser acepta nombres, no un contrato cuantitativo estructurado (`route.ts:35-123`). | No atribuir al proveedor cantidades ni unidades que no entregó. |
| Receta guardada | La ruta compone el texto de ingrediente desde `quantity`, `unit` y `name` (`route.ts:463-470`). La normalización existente puede interpretar subconjuntos cuantitativos (`recipe-requirements.ts:116-145`). | Una receta guardada puede producir comparación cuantitativa si sus datos son parseables y compatibles. |
| Inventario | Cantidad/unidad se almacenan como texto; la normalización/comparación valida cantidad y dimensión (`quantity-normalization.ts`, `recipe-requirements.ts`). | Texto ambiguo o dimensión incompatible permanece `unknown`. |
| Falta de fila | No encontrar el ingrediente en la lectura disponible no acredita inventario completo; las recomendaciones no deben traducirlo automáticamente a `missing`. | Se conserva `unknown` hasta disponer de un contrato de completitud/frescura. |
| Porciones | `scaleIngredients` multiplica cantidades numéricas con unidades reconocidas, deja intactos textos no escalables y marca resultado parcial (`frontend/src/app/recipes/recipe-ui.ts:1-58`). Recipe detail tiene sus pruebas (`frontend/src/app/recipes/recipe-ui.test.ts`). | Escalado es parcial; Today no define porciones objetivo ni debe derivarlas implícitamente de composición del hogar. |
| Plan de comidas | Planificación guarda `peopleCount`; ingredientes estructurados pueden ser `null` y los slots se identifican dentro del plan (`frontend/src/lib/meal-planner/structured-plan.ts`; `frontend/src/app/api/meal-plan/route.ts`). | No es equivalente a porciones objetivo de Today ni prueba qué receta se quiere cocinar. |
| UX actual | Today muestra listas separadas de `Disponible`, `Falta` y `Sin verificar` (`frontend/src/app/app/today-recommendations.tsx:91-97`). | La distinción honesta ya existe; faltan cantidades legibles para auditar disponibilidad conocida. |
| Pruebas existentes | Engine y route prueban ausencia de inventario como desconocida, cantidades parseables sufficient/partial/missing, unidades incompatibles como unknown, restricciones y degradación. Ver `frontend/src/lib/today/local-first-engine.test.ts`, `frontend/src/lib/inventory/recipe-requirements.test.ts`, `frontend/src/app/api/today/route.test.ts`. | Las pruebas apoyan la semántica; no se ejecutaron en U0. |

## 3. Contraste de producción reportada y límites

La aceptación previa de M3.3 observó cuatro opciones válidas de proveedor con `availability: unknown`; la evidencia disponible no incluye cantidades de proveedor, inventario completo/validado ni prueba de receta guardada/historial. Es correcto concluir “no verificable con esta evidencia”, no “el inventario está vacío”, “falta todo” ni “hay un bug”. No se repite ese workflow de aceptación.

El inventario se representa con `quantity` y `unit` textuales (`frontend/src/lib/db/repositories/inventoryRepository.ts`); no se identificó en el modelo leído un marcador global que certifique inventario completo y actualizado. La ausencia o antigüedad no puede reinterpretarse como cero ni como suficiencia.

## 4. M3.4 backlog acotado

| Unidad | Alcance/criterios verificables | Dependencias y no-alcance |
|---|---|---|
| **U1 — Detalle cuantitativo de disponibilidad (actual)** | Exponer en la respuesta actual de Today detalle por ingrediente con requerimiento, disponibilidad, faltante y unidad sólo cuando sean calculables. `null`/`unknown` siguen explícitos. La UI muestra estos detalles sin sustituir las listas/estados actuales. Pruebas de estados cuantitativos y compatibilidad del response existente. | Sin migración, escritura, nuevo endpoint, nuevo input, scaling, reglas de suficiencia nuevas ni llamada a Gemini. La suficiencia reutiliza el comparador existente. |
| **U2 — Selector de porciones y escalado** | Today permite elegir target servings explícitos por receta; el motor escala de forma determinista desde porciones originales declaradas. Sin base explícita, muestra desconocido y pide el dato; conserva texto libre y convierte sólo dimensiones compatibles. TDD para escalado, redondeo y unknown. | No derivar targets del perfil ni ponderar integrantes; no inventar default. No declarar porciones escaladas desde cantidades/unidades no verificables. |
| **U3 — Cantidades estructuradas y procedencia** | Introducir cantidades estructuradas verificables para candidatas guardadas, de historial y Today, con metadatos de procedencia. Camino local primero; respuesta/llamadas existentes compatibles. | IA/Gemini puede sugerir estimaciones, nunca hechos certificados; `sufficient` sólo por validación determinista. No ampliar coste/API externo sin gate. |
| **U4 — Confirmación de inventario** | UI explícita de validación por usuario y estados `registrado`/`verificado`/`desconocido`. Sólo cantidades comparables y confirmadas vigentes pueden fundamentar `sufficient`; inventario no auditado permanece `unknown` o se presenta como indicación limitada no garantizada. Contrato migration-free: confirmación por decisión de cocina, efímera y no persistida; ausencia de fila nunca es cero. | Diseñar cobertura/frescura antes de modificar datos. Si hacen falta esquema, índices, RLS o migración: sólo propuesta, rollback y pruebas aisladas; no aplicar sin autorización. |
| **U5 — Verificación funcional y seguridad** | Pruebas unitarias e integrales/Playwright local, tenant/multiusuario, unknown/partial/incompatible, responsive/accessibility, typecheck, lint, build, CI, RDD/GGA y no-side-effects. | BD local original; no clone/reset/cleanup/contaminación ni servidor paralelo o puerto 3001. Cualquier escritura de prueba requiere fixture disposable protegido y gate; nunca producción. |
| **U6 — Preparación de release** | PR(s) acotados, CI/evidencia y checklist de release, backup/ledger, aceptación y cleanup para un cierre futuro. Abrir PR está permitido por la orden. | No merge, deploy, acceptance productivo, migración o escritura productiva sin autorización PM/owner explícita y gates verificados. No afirmar producción de M3.4 sin comprobarla. |

Las tareas, dependencias y estados reales quedan además enumerados en `odd/tasks/m3-4-u0.md`. PM ya decidió el target explícito por receta y los principios de confianza/frescura. U2–U6 se ejecutan secuencialmente después de consolidar U1, manteniendo `unknown` ante ausencia, parcialidad, antigüedad, incompatibilidad o falta de confirmación.

## 5. Riesgos, límites y verificación

- No añadir nueva ruta ni alterar el formato de la solicitud Today; los campos de respuesta nuevos son aditivos y opcionales.
- No convertir texto libre, falta de fila, `null` o unidad incompatible a cero, `missing` o `sufficient`.
- No escribir inventario/recetas/planes ni invocar proveedores para U1.
- **U1 verification (local, 2026-10-22):** focused Today engine/API/UI tests passed (74/74; the latest rerun passed all 74); full Vitest passed 813 with 8 skipped; `tsc --noEmit` and production build passed; lint reported 0 errors and one existing warning at `frontend/src/next.config.test.ts:6`; `git diff --check` passed. The prior frozen U1 candidate received native review approval and acknowledgement. This U1 is still local/uncommitted at this record's update; there is no PR, CI run, merge, or production release for M3.4.
- No DB connection, production operation, acceptance workflow, migration, merge, deploy, or external Gemini call occurred for U1.
- No hubo conexión a la BD local, producción, Gemini, migración, workflow de acceptance, merge ni deploy.

## 6. Fuentes

- `frontend/src/app/api/today/route.ts`
- `frontend/src/lib/today/local-first-engine.ts` y `local-first-engine.test.ts`
- `frontend/src/lib/inventory/recipe-requirements.ts`, `quantity-normalization.ts`, `recipe-requirements.test.ts`
- `frontend/src/app/recipes/recipe-ui.ts` y `recipe-ui.test.ts`
- `frontend/src/app/app/today-recommendations.tsx`
- `frontend/src/app/api/today/route.test.ts`
- `frontend/src/lib/db/repositories/inventoryRepository.ts`
- `frontend/src/app/api/meal-plan/route.ts`, `frontend/src/lib/meal-planner/structured-plan.ts`
