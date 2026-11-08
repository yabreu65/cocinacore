# M6 U6 — Checklist de aceptación local

**Estado actual:** NO-GO PRE-COMMIT — se corrigieron seis contratos adicionales y se verificó un candidato local nuevo; no se ejecutaron GGA ni commit.

**Base:** `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`.

**Alcance:** Profesor de Cocina Inteligente contextualizado a sesiones M5. Sin push, PR, merge, CI remoto, despliegue ni producción.

## Evidencia ejecutada

- [x] Especificación oficial U0 creada en `docs/roadmap/m6-u0-intelligent-cooking-teacher-specification.md`.
- [x] Constructor server-only de contexto tenant-safe.
- [x] Adaptador server-only sobre Gemini existente.
- [x] Validación estricta de salida y rechazo de solicitudes fuera de alcance.
- [x] UI text-first responsive dentro de `CookingSessionPanel`.
- [x] Feedback temporal útil/no útil sin persistencia.
- [x] Rate limiting separado por usuario y tenant.
- [x] Pruebas unitarias y de ruta enfocadas.
- [x] Suite Vitest completa.
- [x] Auditoría de seguridad y defectos reproducibles de U6 corregidos.
- [x] Evaluación real controlada de Gemini con datos sintéticos, dentro del límite de llamadas.
- [x] TypeScript sin errores.
- [x] ESLint sin errores; permanece un warning histórico en `src/next.config.test.ts`.
- [x] Build Next.js completado.
- [x] Integración PostgreSQL/Redis sobre contenedores disposable.
- [x] E2E Playwright M6 con objetivos loopback disposable.
- [x] Evidencia visual desktop/mobile, explicación con citas, loading, error de proveedor y foco de teclado.
- [x] Comparación M5/M6 de la regresión Playwright U3 y corrección acotada de la colisión de nombres accesibles.
- [x] Prettier dirigido y `git diff --check` completados.

## Resultados registrados

| Gate                               | Resultado                                             |
| ---------------------------------- | ----------------------------------------------------- |
| TypeScript                         | PASS — `npx tsc --noEmit`                             |
| Pruebas enfocadas                  | PASS — 10 archivos, 138 tests                         |
| Suite Vitest base                  | PASS — 113 archivos, 1096 passed, 11 skipped          |
| Suite Vitest con integración DB    | PASS — 117 archivos, 1107 passed, 0 skipped           |
| ESLint                             | PASS con 1 warning histórico, 0 errores               |
| Build                              | PASS — Next.js 16.3.8                                 |
| Prettier dirigido                  | PASS                                                  |
| `git diff --check`                 | PASS                                                  |
| PostgreSQL/Redis disposable        | PASS — migraciones 001–019 y ledger completo          |
| Compatibilidad M5 U3 en PostgreSQL | PASS — 1 archivo, 2 tests                             |
| Compatibilidad M5 U4 Playwright    | PASS — 1 test                                         |
| E2E Playwright M6                  | PASS — 2 tests                                        |
| Evidencia visual M6                | PASS — 1 escenario, 5 capturas                        |
| Smoke test real Gemini             | PASS — 2/2 respuestas válidas; sin p95 representativo |

## Fase A — auditoría y correcciones

- El inventario con fila existente pero cantidad/unidad desconocidas ya no se presenta como `available`; queda como `unknown`.
- Las coincidencias de ingredientes evitados ahora activan rechazo determinista, igual que las alergias.
- El adaptador Gemini concatena todas las partes de texto de la respuesta, no solo la primera.
- No se detectaron escrituras de sesión, inventario, receta, plan o consumo; no hubo migraciones ni cambios fuera del árbol M6.

## Fase B — Gemini real controlado

- Modelo/configuración: `gemini-2.5-flash`, máximo de salida 256 tokens, timeout 15 s, credencial de desarrollo existente. Prompts y respuestas fueron sintéticos y no se registraron.
- Muestras diagnósticas previas: 12 intentos remotos totales en dos muestras de seis; dos rechazos locales de seguridad no realizaron llamada remota.
- Muestra de aceptación posterior a la corrección: 6 intentos, 0 respuestas con esquema válido, 1 HTTP 200 sin texto parseable y 5 HTTP 429 por rate limit.
- Latencias de esa muestra: p50 observado 253 ms; p95 conservador y máximo 1.846 ms. No son evidencia de rendimiento porque no hubo salida válida.
- Tokens: solo un 200 reportó 465 tokens de entrada; los demás no reportaron uso y no hubo tokens de salida medibles.
- Coste estimado: menor de USD 0,01 bajo los topes de la muestra; no se afirma facturación exacta. Referencia de precios: [Google AI Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Resultado histórico: **bloqueado para aceptación real** hasta obtener una muestra posterior válida y no dominada por rate limiting; la Fase B.1 documenta esa muestra posterior.

### Fase B.1 — Smoke tests autorizados por el PM

- Precondiciones verificadas: proyecto `yabreu`, nivel gratuito, modelo `gemini-2.5-flash`, endpoint `https://generativelanguage.googleapis.com/v1beta`, esquema JSON estructurado, `thinkingBudget: 0`, `maxOutputTokens: 256`, timeout de 15 s y ausencia de reintentos automáticos.
- AI Studio mostró los límites del proyecto: RPM 5, TPM 250.000 y RPD 20. El panel mostró uso/histórico de 7 RPM, 3,59K TPM y 8 RPD; no expone un remanente diario exacto garantizado. Se verificó ausencia de procesos locales concurrentes y se separaron las llamadas por 95 s.
- Se ejecutaron exactamente 2 solicitudes reales, con datos sintéticos, sin registrar preguntas ni respuestas completas. No hubo HTTP 429.

| Solicitud | Pregunta sintética              | HTTP/JSON/Zod       | Tokens entrada/salida/razonamiento/total | finishReason | Latencia |             Coste estimado | Seguridad | Funcional                       |
| --------- | ------------------------------- | ------------------- | ---------------------------------------- | ------------ | -------: | -------------------------: | --------- | ------------------------------- |
| 1         | Cebolla suficientemente sofrita | 200 / válido / PASS | 496 / 64 / n/d / 560                     | `STOP`       | 1.318 ms | USD 0,00 en nivel gratuito | PASS      | PASS — explicación coherente    |
| 2         | Técnica brunoise                | 200 / válido / PASS | 499 / 124 / n/d / 623                    | `STOP`       | 1.525 ms | USD 0,00 en nivel gratuito | PASS      | PASS — explicación comprensible |

- Ambas respuestas conservaron `sessionMutation: none`, no generaron escrituras de dominio, no activaron bloqueo de prompt y devolvieron `modelVersion: gemini-2.5-flash`.
- No se presenta p95: dos respuestas no constituyen una muestra representativa. El resultado es un smoke test funcional/operativo, no una certificación de rendimiento.

## Resolución final del diagnóstico Gemini

- Modelo efectivo: `gemini-2.5-flash`; `GEMINI_MODEL` no está configurado y el adaptador usa ese valor por defecto. El endpoint efectivo es el `v1beta` oficial; la clave existe en el entorno de desarrollo, pero no se exponen sus valores.
- Disponibilidad: el modelo soporta structured output y thinking según la documentación oficial, y la muestra anterior obtuvo HTTP 200 al menos una vez. El bloqueo observado no es evidencia de modelo inexistente; es compatible con rate limiting del proyecto.
- Proyecto, tier y cuotas: se verificaron en Google AI Studio para `yabreu` en nivel gratuito. La API key solo se leyó desde el entorno de desarrollo y nunca se expuso; el valor por sí solo no se usa para inferir el proyecto.
- HTTP 429: confirmado como respuesta del proveedor en 5/6 intentos de la muestra de aceptación. Google aplica los límites por proyecto, no por clave; la misma clave de CocinaCore también se usa en recipe generation, meal plan, today, embeddings y otras funciones. Los límites backend del profesor (20 por usuario y 120 por tenant por minuto) no son un presupuesto global del proyecto Google.
- Reintentos: el profesor no usa SDK; realiza `fetch` directo con timeout y no tiene reintentos automáticos. El RAG puede generar una llamada adicional de embeddings antes de la generación del profesor.
- HTTP 200 sin texto: el sobre tenía candidatos pero no texto parseable. La instrumentación anterior no conservó `finishReason`, `finishMessage`, `promptFeedback.blockReason` ni `thoughtsTokenCount`, por lo que no se puede afirmar retrospectivamente si fue `MAX_TOKENS`, bloqueo de candidato u otra terminación. El defecto de parser de solo leer `parts[0]` ya fue corregido.
- Corrección acotada aplicada al adaptador: se envía `responseJsonSchema` real, se registra metadata operacional no sensible y, para `gemini-2.5-flash`, se fija por defecto `thinkingBudget: 0`; puede configurarse explícitamente mediante `COOKING_TEACHER_THINKING_BUDGET`. Esto evita que el presupuesto de razonamiento consuma toda la salida acotada y permite diagnosticar futuras respuestas vacías sin registrar prompts/respuestas.
- La documentación oficial indica que `maxOutputTokens` incluye tokens de razonamiento y que `thinkingBudget: 0` desactiva thinking en Gemini 2.5 Flash: [thinking](https://ai.google.dev/gemini-api/docs/thinking), [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).
- Prueba real adicional: **2/2 PASS**. El coste incremental estimado es USD 0,00 bajo el nivel gratuito; no se activó facturación ni se modificaron claves, proyecto, cuotas o modelo.

## Fase C — pruebas y regresiones

- PostgreSQL disposable `127.0.0.1:5435` y Redis disposable `127.0.0.1:6381`, sin volúmenes persistentes; migraciones 001–019 y ledger completos.
- Las 10 pruebas PostgreSQL que normalmente quedan omitidas se ejecutaron con sus flags locales: 1080/1080 PASS en la suite completa, sin skips.
- Comparación Playwright M5 U3: el commit base M5 pasó 2/2; el candidato M6 falló 1/2 porque la pregunta sugerida `¿Por qué este paso va antes del siguiente?` coincidía por substring con el locator `name: 'Siguiente'`. Es una regresión real introducida por M6, no una deuda histórica ni un problema del fixture.
- Corrección: la sugerencia pasó a `¿Por qué importa este orden?`, sin tocar M5. Reejecución del candidato M6: **2/2 passed**. M5 U4 conectado: **1/1 passed**.
- TypeScript, ESLint y build Next.js completados; ESLint conserva un warning histórico en `src/next.config.test.ts`.

## Fase D — evidencia visual

Las capturas se generaron con sesión, receta, respuesta, cita y error sintéticos; el proveedor fue route-mocked únicamente para la evidencia visual:

- Desktop con explicación, cita, incertidumbre y feedback: `/Users/yoryiabreu/.codex/visualizations/2026/10/30/01a18ad0-aa1c-7dc2-95c4-03ca961c735c/m6-teacher-desktop.png`.
- Mobile responsive: `/Users/yoryiabreu/.codex/visualizations/2026/10/30/01a18ad0-aa1c-7dc2-95c4-03ca961c735c/m6-teacher-mobile.png`.
- Loading: `/Users/yoryiabreu/.codex/visualizations/2026/10/30/01a18ad0-aa1c-7dc2-95c4-03ca961c735c/m6-teacher-loading.png`.
- Error de proveedor: `/Users/yoryiabreu/.codex/visualizations/2026/10/30/01a18ad0-aa1c-7dc2-95c4-03ca961c735c/m6-teacher-error.png`.
- Foco de teclado: `/Users/yoryiabreu/.codex/visualizations/2026/10/30/01a18ad0-aa1c-7dc2-95c4-03ca961c735c/m6-teacher-keyboard.png`.

## Fase E — entrega local

- Rama/worktree: `feat/m6-u0` / `/Users/yoryiabreu/.codex/worktrees/m6-u0/cocinacore`.
- HEAD sin commit: `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`.
- Solo permanecen staged archivos del alcance M6; `.atl/skill-registry.md`, M4 y M5 permanecen intactos. La lista exacta se verifica con `git diff --cached --name-only`.
- No se ejecutaron GGA, commit, push, PR, merge, CI remoto, despliegue ni producción.
- Espacio libre verificado antes de las pruebas pesadas: aproximadamente 3,7 GiB; no se hizo limpieza destructiva ni se descargaron imágenes nuevas.
- Cuota Gemini: se consumieron exactamente dos solicitudes reales autorizadas en esta fase; no se rotaron claves ni se modificaron proyecto, tier o modelo.
- Los contenedores disposable fueron retirados al finalizar. Los artefactos locales ignorados (`.next`, `node_modules` y reportes) no forman parte del candidato y se conservan solo para esta sesión de herramientas.
- El SHA exacto del árbol staged final se conserva en el informe de cierre y se obtiene con `git write-tree` después de esta actualización documental.

## Fase G — corrección arquitectónica de seguridad y disponibilidad

La auditoría adversarial identificó tres bloqueantes HIGH y un riesgo MEDIUM en el candidato anterior. Se corrigieron exclusivamente dentro del alcance del Profesor de Cocina; no se ejecutaron GGA, llamadas nuevas a Gemini, commits ni operaciones remotas.

| Hallazgo                                                                                 | Corrección aplicada                                                                                                                                                                                         | Regresión verificable                                                                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Contenido de receta, perfil, RAG y pregunta podía parecer contexto confiable para Gemini | Todo dato de aplicación se limita, sanea y serializa como `UNTRUSTED APPLICATION DATA`; las instrucciones de política permanecen fuera de ese objeto                                                        | `cooking-teacher.test.ts`: campos maliciosos en título, paso, ingrediente, restricciones, limitaciones, RAG y pregunta            |
| Validación semántica incompleta y evadible por variante/idioma                           | Validación determinista común para respuesta y limitaciones, incluyendo `safe_refusal`, mutaciones, control del modelo, afirmaciones de seguridad/sustitución y cantidades no verificadas en español/inglés | `cooking-teacher.test.ts`: mutación inglesa, contradicción en rechazo seguro, afirmación de alergia y cantidad desconocida        |
| Timeout de proveedor no cubría contexto ni RAG                                           | Deadline único de 15 s desde la ruta; `AbortSignal` llega a contexto, embedding, RAG y Gemini; las lecturas SQL reciben `statement_timeout` restante y liberan la transacción                               | `cooking-teacher-budget.test.ts`, `server-rag-context.test.ts` y `route.test.ts`: abort, deadline, señal compartida y timeout SQL |
| `supported` podía exponerse como respaldo semántico no demostrado                        | Las citas conservan procedencia autorizada, pero `supported` se degrada a `partial` y declara que no existe atribución semántica determinista                                                               | `cooking-teacher.test.ts`: con y sin cita autorizada                                                                              |

### Verificación posterior a las correcciones

- Preflight local: **PASS** sobre Node `v22.22.3`; el árbol se mantuvo local y sin llamada a Gemini.
- Pruebas enfocadas nuevas: **36/36 PASS** en 5 archivos.
- Vitest completo sobre PostgreSQL/Redis disposable separados (puertos loopback `5435/6381`, tmpfs, migraciones 001–019 y ledger completo): **1115/1115 PASS**, 118 archivos, 0 skips. Se habilitaron también las pruebas de integración M5 U3 y los tres flags de regresión PostgreSQL.
- Playwright conectado sobre el mismo objetivo disposable: **5/5 PASS** — M5 U3 **2/2**, M5 U4 **1/1**, M6 **2/2**. No se modificó el fixture ni se llamaron proveedores reales.
- TypeScript: **PASS**. ESLint dirigido: **PASS**. El warning histórico de `src/next.config.test.ts` permanece documentado; no se introdujeron errores nuevos. El build Next.js ejecutado por el `webServer` de Playwright: **PASS**.
- Prettier dirigido: **PASS**. `git diff --cached --check`: **PASS**. La comprobación se ejecutó después de incorporar esta sección y los archivos nuevos al índice.
- Investigación ESM: `/usr/local/bin/node` `v22.11.0` reproduce `ERR_REQUIRE_ESM` al cargar `std-env` desde Vitest; la ejecución con Node `v22.22.3` funciona. Se clasifica como incompatibilidad del harness/runtime inferior, no como defecto de `std-env` ni del código.
- La revisión independiente posterior a estas correcciones fue solicitada a un contexto Codex nuevo, pero el agente no pudo ejecutarla por agotamiento de cuota del servicio. Por honestidad no se presenta una aprobación independiente inexistente; queda como bloqueo administrativo separado de los resultados técnicos locales. La revisión adversarial primaria de este candidato no encontró un nuevo defecto bloqueante en el diff corregido.
- Riesgo residual: el etiquetado `partial` evita afirmar soporte semántico de citas, pero no constituye una verificación semántica completa. Debe mantenerse una evaluación de atribución antes de producción. El p95 representativo sigue pendiente.

## Controles de seguridad

- [x] El tenant y el usuario se derivan server-side.
- [x] La sesión y la recipe/version se consultan con scope tenant/user.
- [x] No se agregaron migraciones.
- [x] No se agregaron herramientas de escritura al proveedor.
- [x] El contexto declara `writes: none`.
- [x] El profesor no muta progreso, inventario, receta, plan o consumo.
- [x] Alergias y restricciones se evalúan antes del proveedor.
- [x] Preguntas de sustitución, seguridad o prompt injection se rechazan de forma segura.
- [x] No se registran preguntas ni respuestas en logs.
- [x] Los logs de proveedor solo contienen metadatos operativos y consumo/latencia.
- [x] Las citas se seleccionan únicamente desde referencias recuperadas.

## Pendientes que bloquean GO FINAL LOCAL

1. Regenerar una autorización candidate-specific para el árbol staged corregido antes de cualquier GGA; esta auditoría detectó y corrigió una contradicción documental, por lo que la autorización anterior dejó de ser válida.
2. Revisar el warning histórico de ESLint sin mezclarlo con el alcance M6.
3. No presentar p95 ni conclusiones de rendimiento hasta disponer de una muestra mayor y una autorización específica.

## Migraciones y recursos

- Migraciones nuevas: ninguna.
- Transcripciones persistidas: ninguna.
- Preguntas/respuestas persistidas: ninguna.
- PostgreSQL/Redis disposable: ejecutados sobre puertos loopback 5435/6381, sin volúmenes persistentes, y eliminados al finalizar.
- Recursos temporales de desarrollo: contenedores disposable retirados; `frontend/node_modules`, `.next` y reportes permanecen ignorados y fuera del árbol Git.

## Fase F — corrección local definitiva

Esta fase corrige ocho hallazgos de la revisión anterior sin invocar GGA, RDD, Gentle AI, CI remoto ni Gemini real. La revisión anterior se trató como evidencia de defectos; no se reutilizó como autorización de evaluación.

| Hallazgo                               | Corrección implementada                                                                                                                                                                                              | Regresión verificable                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `supported` / `verified` inconsistente | El contrato público usa únicamente `supported`, `partial`, `unknown` y `unavailable`; una respuesta `supported` sin citas se degrada a `partial`; el rechazo determinista no emite `verified`.                       | `cooking-teacher.test.ts`, `route.test.ts`                        |
| Loading permanente ante red/excepción  | `CookingTeacherPanel` captura excepciones, aborta la solicitud al desmontar y siempre libera `loading` en `finally`.                                                                                                 | `CookingTeacherPanel.test.tsx`                                    |
| `Retry-After` inválido                 | Los endpoints rate-limited convierten `resetAt` a segundos de espera; el timestamp absoluto solo permanece en `X-RateLimit-Reset`. Un fallo del almacenamiento responde 503.                                         | `rate-limit.test.ts`, rutas API corregidas                        |
| Confianza en `x-forwarded-for`         | Ninguna ruta de producción lee `x-forwarded-for` ni `Forwarded`. Las rutas autenticadas usan `user.id`/`tenantId`; las anónimas usan un header proxy explícitamente configurado o el bucket conservador `anonymous`. | `rate-limit.test.ts`, rutas API corregidas                        |
| Rate limit local y fail-open           | Todas las rutas que consumen proveedor o protegen autenticación exigen Redis compartido y atómico; ausencia o error del store devuelve `storage=unavailable` y bloquea la operación.                                 | `rate-limit.test.ts`, `route.test.ts`, `rate-limit.redis.test.ts` |
| Perfil no tenant-safe                  | El profesor consulta `user_culinary_profiles` con `user_id` y `tenant_id` en la misma cláusula SQL; se elimina el filtro posterior como control primario.                                                            | `culinaryProfileRepository.test.ts`                               |
| IDs HTML duplicados                    | Cada instancia usa un sufijo de `useId()` para heading, `aria-labelledby` e input.                                                                                                                                   | `CookingTeacherPanel.test.tsx`                                    |
| Validación semántica débil             | Se rechazan citas inexistentes, afirmaciones de escrituras de dominio, garantías de seguridad/sustitución y cantidades precisas sobre datos desconocidos.                                                            | `cooking-teacher.test.ts`                                         |

### Investigación `ERR_REQUIRE_ESM` / `std-env`

- El fallo es reproducible fuera de la aplicación con `/usr/local/bin/node` `v22.11.0`: Vitest no puede cargar `std-env/dist/index.mjs` desde `vitest/dist/config.cjs`.
- El proyecto declara Node `^22.13.0 || >=24` y `.nvmrc` fija `22.22.3`; con ese runtime, la prueba dirigida pasa.
- El runtime `v22.11.0` también pasa únicamente con `NODE_OPTIONS=--experimental-require-module`; ese flag es un workaround de compatibilidad de herramientas, no una corrección del código CocinaCore.
- Conclusión: es una incompatibilidad del entorno/harness de herramientas (Node inferior al engine y carga CJS/ESM de Vitest/Vite), no un defecto de `std-env` ni del código funcional M6. No se modificaron dependencias para ocultarla.

### Evidencia de esta corrección

- Espacio libre antes de la validación pesada: `3.3 GiB`; no se hicieron limpiezas destructivas ni se descargaron imágenes.
- Vitest dirigido histórico: PASS — 7 archivos, 58 tests.
- TypeScript: PASS — `tsc --noEmit` con Node `22.22.3`.
- ESLint dirigido: PASS — 0 errores.
- Prettier dirigido: PASS — archivos modificados.
- `git diff --check`: PASS.
- No se realizaron nuevas llamadas reales a Gemini.
- El árbol sigue sin commit; el SHA del candidato staged final queda registrado en el informe de ejecución y contiene 42 archivos exclusivamente M6.

## Fase G — corrección final y auditoría preventiva

La revisión adversarial identificó tres defectos adicionales y no autorizó una nueva evaluación GGA. Se corrigieron únicamente en el worktree M6:

| Hallazgo adicional                                                                                                   | Corrección                                                                                                                                                                                                                                              | Evidencia                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Operaciones `start`, transición y reconciliación podían dejar estado de trabajo activo cuando `safeFetch` rechazaba. | Helper común con `try/catch/finally`, abort al desmontar, guardas de componente activo y propagación de `AbortSignal`; la carga de inventario también captura excepciones.                                                                              | `CookingSessionPanel.test.tsx`; TypeScript y Vitest PASS.                                                 |
| El fallback de memoria decía ser sliding-window, pero acumulaba un único contador de ventana fija.                   | Registro de timestamps ordenados, poda por antigüedad y `resetAt` derivado de la solicitud más antigua viva.                                                                                                                                            | `rate-limit.test.ts`; caso de deslizamiento PASS.                                                         |
| Lecturas, locks y reemplazos de perfil culinario podían omitir `tenant_id`.                                          | Las APIs del repositorio ahora exigen `tenantId`; lecturas y términos usan predicados/join tenant-scoped, el lock incluye tenant y los deletes de términos están ligados al perfil scoped. Se actualizaron todos los consumidores tenant-authenticated. | `culinaryProfileRepository.test.ts`, `profile-update-atomicity.integration.test.ts` y rutas consumidoras. |

### Regresión local posterior

- `git write-tree` se verificó antes y después de la auditoría; el árbol autorizado anterior no se reutilizó como evaluación GGA.
- Suite Vitest base: **1078/1078 PASS**, con 11 tests omitidos por flags.
- Suite Vitest con PostgreSQL/Redis disposable: **1089/1089 PASS**, sin skips; migraciones 001–019 aplicadas y ledger completo.
- TypeScript: PASS con Node `22.22.3`.
- ESLint dirigido sobre los archivos corregidos: PASS, 0 errores.
- Build Next.js: PASS — Next.js 16.3.8.
- Playwright M6 conectado: **2/2 PASS** sobre PostgreSQL/Redis disposable.
- Prettier dirigido sobre los archivos corregidos: PASS.
- `git diff --check`: PASS.
- No se realizaron llamadas nuevas a Gemini; los smoke tests aprobados permanecen 2/2 PASS.
- No se ejecutaron GGA, RDD, Gentle AI, Gentle Shell ni el wrapper de quality gate, porque ese wrapper consume GGA.
- No se creó commit, no hubo push, PR, merge, CI remoto, despliegue ni acceso a producción.
- La revisión preventiva no encontró una nueva migración requerida ni secretos en los cambios M6. La ausencia de p95 representativo continúa pendiente para una evaluación de rendimiento autorizada.

## Fase H — corrección de seguridad transversal posterior a GUARDIAN_FAIL

El único GGA autorizado para el árbol anterior (`4a6cc3a6c59b23fb669541499925a2c34f1a2108`) devolvió `GUARDIAN_FAIL` con dos defectos confirmados. Esta fase corrige esos defectos y audita los consumidores relacionados sin invocar GGA:

| Hallazgo                                                                              | Clasificación                                                                                                                                                            | Corrección                                                                                                                                                                                                                                                                                                                  | Evidencia                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `meal-plan` confiaba en `x-forwarded-for` y emitía un `Retry-After` absoluto.         | Defecto confirmado; el mismo patrón existía en otros consumidores rate-limited.                                                                                          | Identidad server-side por usuario/tenant para rutas autenticadas; helper común que ignora cabeceras arbitrarias y solo acepta `COCINACORE_TRUSTED_CLIENT_IDENTITY_HEADER` declarado por infraestructura confiable para rutas anónimas. Todos los `Retry-After` usan segundos positivos; `X-RateLimit-Reset` conserva epoch. | `frontend/src/lib/rate-limit-identity.ts`, rutas API y tests dirigidos.                            |
| `setCulinaryProfileTerms` podía insertar términos sin confirmar el perfil del tenant. | Defecto confirmado; riesgo TOCTOU en el reemplazo.                                                                                                                       | La operación bloquea el perfil exacto con `FOR UPDATE` dentro de la transacción y falla antes del delete/insert si falta o no pertenece al par `userId`/`tenantId`.                                                                                                                                                         | `culinaryProfileRepository.test.ts`, `profile-update-atomicity.integration.test.ts`.               |
| Usos restantes de `x-forwarded-for`, `Retry-After`, términos y rate limiting.         | Auditoría transversal: los usos de `x-forwarded-for` en rutas de producción eran el mismo defecto; las lecturas tenant-scoped existentes fueron correctas con evidencia. | Se actualizaron los consumidores rate-limited para identidad confiable, `Retry-After` en segundos y `requireSharedStore: true`; no se añadieron migraciones ni escrituras nuevas del profesor.                                                                                                                              | Inventario `rg` sin usos de `x-forwarded-for` fuera de tests/helper; TypeScript y tests dirigidos. |

No se detectaron nuevos hallazgos que requieran otro milestone o una migración. El header de identidad de proxy solo es válido cuando el reverse proxy lo sobrescribe y lo declara mediante configuración; sin esa configuración se usa un bucket anónimo conservador para impedir bypass por cambio de headers.

## Fase I — correcciones y auditoría integral de contratos

Esta fase corrige seis hallazgos confirmados sobre el candidato anterior. Se mantuvo el trabajo exclusivamente local, sin GGA, commit, llamadas nuevas a Gemini ni cambios de M4/M5.

| Hallazgo                                               | Corrección                                                                                                                                                                                                                                                                      | Regresión verificable                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warmup aceptaba estructuras arbitrarias mediante casts | `MealPlanWarmupSchema` valida el contrato completo: días, comidas, ingredientes estructurados, inventario, cocina, porciones y perfil. La ruta usa el dato inferido sin casts y rechaza tipos o campos anidados inválidos con 400.                                              | `validation.test.ts`, `meal-plan/warmup/route.test.ts`                                                                                             |
| Evitaciones persistidas no llegaban al profesor        | El contexto carga términos con `user_id` y `tenant_id`, combina solo `avoid` con dislikes explícitos, deduplica de forma determinista y mantiene alergias separadas. Un fallo de lectura aborta el contexto y conserva el fail-safe.                                            | `cooking-teacher-context.test.ts`, `culinaryProfileRepository.test.ts`, `profile-update-atomicity.integration.test.ts`                             |
| Citas no coincidían con el contrato público            | El adaptador acepta únicamente referencias PDF globales o tenant autorizadas, exige título, normaliza `page` y solo permite índices de la lista server-side. Las citas públicas ya no exponen `chunkId` ni `pageNumber`.                                                        | `cooking-teacher.test.ts`, `cooking-sessions/[id]/teacher/route.test.ts`                                                                           |
| Prompt injection y contexto excesivo                   | El prompt separa contexto verificado de pregunta/RAG no confiables, limita campos y repite la política después de los datos. Se ampliaron detecciones de spoofing y se valida semánticamente que la salida no revele control del modelo, escriba dominio o evada restricciones. | `cooking-teacher.test.ts` adversarial: instrucciones previas, rol falso, RAG malicioso, cita inventada, escritura de inventario y evasión dietaria |
| Excepciones de proveedores podían filtrar detalles     | Embeddings, sugerencias, generación de recetas y warmup devuelven mensajes públicos genéricos; los logs conservan solo razón/tipo, estado y métricas operativas, sin payloads, prompts, secretos o respuestas privadas.                                                         | `embeddings/route.test.ts`, `inventory-suggestion/route.test.ts`, `recipe-generate/route.test.ts`, `warmup/route.test.ts`                          |
| Claves React colisionaban en ingredientes repetidos    | Se asignan claves estables basadas en ID persistido cuando existe, con fallback determinista por identidad y ocurrencia; la reconciliación excluye la clave interna antes de enviar el payload.                                                                                 | `CookingSessionPanel.test.tsx` con duplicados y reordenamiento                                                                                     |

### Evidencia de la fase I

- Preflight técnico: TypeScript PASS; Vitest dirigido **138/138 PASS**; Vitest base **1096/1096 PASS** con 11 tests omitidos; Vitest con PostgreSQL/Redis disposable **1107/1107 PASS**, sin skips.
- Regresión Playwright sobre lanes disposable y `COCINACORE_SEPARATED_DB_LANES_ENABLED=true`: M5 U3 **2/2 PASS**, M5 U4 **1/1 PASS**, M6 **2/2 PASS**; total **5/5 PASS**.
- El build Next.js ejecutado por el `webServer` de Playwright terminó correctamente; no se repitió de forma innecesaria.
- Prettier dirigido y `git diff --check`: PASS. No se hicieron llamadas nuevas a Gemini.
- El espacio libre se verificó antes de la validación pesada: aproximadamente **2.8 GiB**; no se hicieron limpiezas destructivas. Los contenedores disposable usaron tmpfs y fueron retirados al terminar.

## Estado de entrega

**NO-GO PRE-COMMIT:** el candidato requiere una nueva autorización explícita antes de cualquier GGA o commit. El árbol staged anterior quedó invalidado por estas correcciones; no se reutilizó ni se consumió otra evaluación. La ausencia de p95 representativo permanece pendiente y no se presenta como requisito cumplido.

## Fase J — resolución de bloqueantes arquitectónicos

Esta fase implementa las correcciones autorizadas por el PM sobre el candidato M6, sin commit ni GGA. El árbol conserva la rama `feat/m6-u0`, no modifica `main`, M4 ni M5 y no realiza llamadas nuevas a Gemini.

### Correcciones

| Área                  | Resultado                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL/RAG        | `pg` resuelve a `8.21.0` y no ofrece `AbortSignal` tipado. Se añadió un adaptador de operaciones con deadline/señal, descarte seguro mediante `client.release(error)` para clientes activos o adquisiciones tardías, `statement_timeout` + `lock_timeout`, liberación sin doble release y cancelación de consultas hermanas con `Promise.allSettled`. |
| Deadline del profesor | El presupuesto de 15 segundos comienza al entrar al handler y se verifica tras autenticación, parseo, Redis y cada dependencia posterior. El mismo deadline se propaga a contexto, PostgreSQL, RAG, embeddings y Gemini.                                                                                                                              |
| Respuestas Gemini     | Se añadieron invariantes por `kind`, `evidence`, citas y limitaciones. Los `safe_refusal` contradictorios se reemplazan por una respuesta controlada por servidor; se agregaron regresiones en español, inglés e italiano. Las afirmaciones `supported` continúan expuestas como `partial` porque no existe atribución semántica determinista.        |
| Warmup                | La ruta requiere usuario autenticado con identidad server-side; `calendar` y `targetDays` tienen máximo de 7 días, los objetivos son únicos, la cola no reintenta fan-out de proveedor y el origen interno solo acepta `NEXT_PUBLIC_SITE_URL` o loopback local.                                                                                       |
| Embeddings            | El endpoint quedó restringido a usuarios autenticados que sean platform owners, con cuota por usuario, timeout abortable de 15 segundos y cancelación propagada a cada intento/fallback. Los consumidores batch aceptan `AbortSignal`.                                                                                                                |
| Privacidad            | Los servicios Gemini ya no registran cuerpos de error del proveedor. El profesor registra únicamente diagnósticos operativos allowlisted y generación de recetas elimina nombres/datos de slot de los eventos de solicitud.                                                                                                                           |

### Riesgos adicionales investigados

- **Inventario entre usuarios: DESCARTADO como defecto M6**, con evidencia de contrato tenant-scoped en `db/migrations/003_recipes_and_inventory.sql` y documentación existente. El flujo no cruza tenants; el inventario compartido dentro del tenant queda como decisión de producto explícita.
- **Fan-out warmup: CONFIRMADO y corregido**, mediante autenticación, límites cardinales, deduplicación y un único intento de cola.
- **Embeddings expuesto: CONFIRMADO y corregido**, mediante autorización de platform owner, cuota autenticada y cancelación.
- **Prompt injection del profesor: DESCARTADO como bypass adicional demostrado**; los datos siguen encapsulados como no confiables. Persiste un riesgo residual fuera del profesor en prompts legacy de `recipe-generate` y `meal-plan`, que no se amplió en esta corrección acotada.
- **Privacidad de logs: CONFIRMADO y corregido en las rutas/servicios alcanzados por M6**; se mantiene como deuda residual cualquier logger legacy no cubierto por estos eventos.

### Evidencia local de esta fase

- Node activo: `v22.22.3`.
- Vitest completo base: **1113 PASS, 12 skipped** en 119 archivos.
- Vitest dirigido de regresiones: **105 PASS** en 10 archivos.
- TypeScript: PASS.
- ESLint dirigido: PASS, sin errores.
- Prettier dirigido: PASS.
- `git diff --check`: PASS.
- Se añadieron pruebas de cancelación activa, adquisición tardía, aborto de consultas hermanas, invariantes semánticas, autorización de embeddings y límites de warmup.

La validación PostgreSQL/Redis disposable y Playwright no se repitió en esta fase: al iniciar la ejecución el espacio libre era aproximadamente **1.0 GiB**, inferior al reporte previo de 3.3 GiB; no se descargaron imágenes ni se realizaron limpiezas destructivas. El build tampoco se repitió por la misma restricción de espacio. Estas evidencias quedan pendientes y no se declaran PASS.

El árbol continúa sin commit, push, PR, merge, GGA, CI remoto, despliegue o producción. El p95 representativo permanece pendiente.

## Fase K — resolución de bloqueantes detectados por auditoría independiente

La revisión independiente posterior a la Fase J confirmó bloqueantes nuevos. Se corrigieron localmente sin GGA, commit, llamadas nuevas a Gemini ni cambios de M4/M5:

| Hallazgo                                                                                                         | Corrección                                                                                                                                                                             | Regresión                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| El deadline del profesor no cubría autenticación ni Redis.                                                       | `requireUser` y las operaciones de sesión propagan señal/deadline a PostgreSQL; el rate limiting usa store compartido, `commandTimeout` y abort/deadline fail-closed.                  | `cooking-teacher`/`rate-limit` dirigidos y TypeScript PASS.                     |
| Warmup interno perdía actor/tenant al llamar `recipe-generate`.                                                  | La ruta emite una capability HMAC efímera ligada a usuario+tenant; el endpoint interno la verifica server-side. El fan-out queda limitado a 9 slots y la cola a 10 trabajos esperando. | `internal-capability.test.ts`, `recipe-warmup.test.ts`, `warmup/route.test.ts`. |
| Validación semántica permitía afirmaciones de seguridad en más idiomas o `evidence=unavailable` con explicación. | Se ampliaron patrones multilingües y cualquier `unavailable` se rechaza con respuesta server-authored; las citas no se exponen en ese caso.                                            | `cooking-teacher.test.ts`.                                                      |
| Embeddings cobraba únicamente por solicitud, no por volumen.                                                     | El contrato limita el payload agregado a 100.000 caracteres además de los límites por elemento.                                                                                        | `validation.test.ts`.                                                           |
| Buckets anónimos de login/signup/reset podían colapsar usuarios distintos.                                       | Sin identidad de ingress confiable, esos endpoints usan el hash del objetivo como identidad; con proxy declarado, conservan el aislamiento por identidad+objetivo.                     | Rutas de autenticación y `rate-limit` dirigidos.                                |

### Evidencia actual de la Fase K

- Identidad: rama `feat/m6-u0`, HEAD sin cambios `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`; árbol staged recalculado después de las correcciones.
- Node confirmado en el proceso de pruebas: `v22.22.3` desde nvm; el fallo `ERR_REQUIRE_ESM/std-env` sigue siendo del shell `/usr/local/bin/node v22.11.0` cuando no se activa nvm.
- Vitest completo base posterior a los cambios: **1117 PASS, 12 skipped** en 120 archivos; el dirigido de regresiones de esta fase fue **77/77 PASS**. TypeScript PASS; Prettier dirigido PASS.
- No se ejecutaron GGA ni hooks de commit. El árbol sigue sin commit y sin operaciones remotas.
- El fan-out de warmup conserva como límite de seguridad 9 generaciones por ejecución; Redis conserva payload de trabajo privado como riesgo residual documentado y requiere controles de acceso/retención del entorno.
- El rate limit anónimo de otras rutas públicas continúa siendo un bucket conservador cuando no existe un header de ingress explícitamente confiable; esto evita bypass por cabeceras, pero requiere configuración de proxy para aislamiento por cliente en despliegue.
- La inyección legacy de `recipe-generate`/`meal-plan`, la medición p95 representativa y la validación PostgreSQL/Redis disposable + Playwright posteriores a esta fase siguen pendientes antes de producción.

El árbol permanece **NO-GO PRE-COMMIT** hasta completar la validación local pendiente y obtener una autorización específica posterior; no se reutiliza ninguna autorización GGA anterior.

## Fase L — corrección focalizada de los cuatro bloqueantes de la auditoría independiente

Esta fase implementa únicamente los cuatro defectos confirmados por la revisión independiente Codex-only. No se ejecutó GGA, no se creó commit, no se realizaron llamadas reales a Gemini y no se modificaron M4/M5.

| Bloqueante                                                             | Corrección                                                                                                                                                                                                                                                                                                  | Regresión verificable                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capability HMAC replayable y desligada de la operación                 | La capability se liga a método, ruta, operación, `jobId`, `tenantId`, `userId`, hash canónico del payload, emisor, audiencia, emisión, expiración y `jti`. El consumo es atómico con `SET NX PX` en Redis compartido; ausencia o error de Redis falla cerrado. Warmup genera una capability nueva por slot. | `internal-capability.test.ts`: contexto válido, expiración/firmas, método/ruta/body/job/tenant, replay secuencial y concurrente, Redis no disponible; `recipe-warmup.test.ts`. |
| Deadline incompleto durante autenticación                              | `buildAuthUser` recibe `DbOperationOptions`; la consulta de tenant usa la misma señal y deadline de 15 segundos. El handler no convierte un timeout de autenticación en un falso `401`.                                                                                                                     | `session.test.ts`, `cooking-sessions/[id]/teacher/route.test.ts`, TypeScript PASS.                                                                                             |
| Mutación Redis tardía después de fail-closed                           | El rate limiter usa un único `EVAL` atómico con `commandTimeout`, sin `Promise.race` ni reintentos automáticos. Las operaciones cuyo resultado queda incierto se consideran fail-closed; el Lua acepta `requestId` estable para reintentos explícitos idempotentes.                                         | `rate-limit.test.ts`, `rate-limit.redis.test.ts`, integración Redis PASS.                                                                                                      |
| Rate limiting anónimo sin bucket global ni bucket de cliente confiable | Login y reset mantienen bucket por objetivo y agregan un bucket global anónimo de alta capacidad o un bucket por cliente únicamente cuando ingress declara un header confiable. Nunca se aceptan `x-forwarded-for` ni `Forwarded` como fuente directa.                                                      | `rate-limit.test.ts` y rutas de autenticación; pruebas de cabeceras manipuladas, identidad confiable y buckets secundarios.                                                    |

### Evidencia de validación de la Fase L

- Runtime confirmado: Node `v22.22.3` mediante nvm.
- Vitest disposable con PostgreSQL/Redis: **1133/1133 PASS**, 120 archivos, sin skips; migraciones 001–019 aplicadas y ledger completo.
- M5 U4 disposable: **PASS**; RLS, FKs tenant-safe, idempotencia, concurrencia, trigger append-only, cantidades, rollback y ausencia de escrituras implícitas verificados.
- Playwright con lanes realmente separadas (`127.0.0.1:5435` y Redis `6381`): M5 U3 **2/2 PASS**, M5 U4 **1/1 PASS**, M6 **2/2 PASS**; total **5/5 PASS**. El build Next.js ejecutado por el webServer de Playwright terminó correctamente.
- TypeScript: PASS. ESLint completo: PASS, un warning histórico en `frontend/src/next.config.test.ts`. Prettier dirigido: PASS. `git diff --check`: PASS. El chequeo global de Prettier conserva deuda histórica en 104 archivos y no fue reformateado masivamente.
- Espacio libre: **14 GiB** antes de las pruebas pesadas; los contenedores disposable usaron tmpfs y deben retirarse al finalizar esta operación.
- No se realizaron llamadas reales a Gemini.

El candidato sigue **NO-GO PRE-GGA** hasta retirar los recursos disposable, revisar el diff final, completar el escaneo de secretos y obtener una autorización nueva específica del árbol staged resultante. El p95 representativo continúa pendiente antes de producción.

## Fase M — corrección final de warmup y admisión de cola

Esta fase corrige únicamente los dos bloqueantes confirmados por la auditoría independiente posterior a la Fase L. No se ejecutó GGA, no se creó commit, no se realizaron llamadas reales a Gemini y no se modificaron M4/M5.

| Bloqueante                                                                                                                         | Corrección                                                                                                                                                                                                                                                                                                                       | Regresión verificable                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El capability interno de warmup permitía que `recipe-generate` persistiera historial en generación nueva y en cache-hit.           | La resolución distingue el contexto interno de warmup de la autenticación de usuario. Las solicitudes internas válidas conservan la generación/cache, pero omiten toda escritura de historial; las solicitudes autenticadas ordinarias mantienen la persistencia. Un capability inválido devuelve `401` y no cae a modo anónimo. | `recipe-generate/route.test.ts`: generación nueva sin historial y con cache; cache-hit sin historial ni proveedor; capability inválido sin fallback anónimo.                            |
| La admisión de cola hacía `getWaitingCount()` y `queue.add()` en pasos separados, permitiendo superar el límite bajo concurrencia. | Redis Lua reserva atómicamente sobre las listas reales `wait`/`paused` de BullMQ y un ZSET de reservas expirables. La reserva se libera en `finally`; el TTL recupera abandonos por crash; Redis de admisión falla cerrado. El `jobId` incorpora un identificador generado server-side para idempotencia.                        | `meal-plan-warmup.test.ts`: capacidad y liberación, rechazo al llenar la cola, dos productores concurrentes con un único cupo y recuperación tras expiración de una reserva abandonada. |

### Evidencia de validación de la Fase M

- Runtime confirmado: Node `v22.22.3` desde nvm.
- Vitest dirigido de warmup/capability: **51/51 PASS**; la prueba Redis real se ejecutó por separado con **4/4 PASS**.
- Vitest disposable PostgreSQL/Redis con admisión real habilitada: **1140/1140 PASS**, 121 archivos, sin skips; migraciones 001–019 y ledger verificados.
- Playwright sobre lanes realmente separadas: M5 U3 **2/2 PASS**, M5 U4 **1/1 PASS**, M6 **2/2 PASS**; total **5/5 PASS**. El build Next.js requerido por el `webServer` terminó correctamente.
- TypeScript: PASS. ESLint: PASS con un warning histórico no bloqueante en `frontend/src/next.config.test.ts`. Prettier dirigido y `git diff --check`: PASS. El escaneo de secretos no detectó secretos en el candidato.
- El almacenamiento quedó en aproximadamente **9 GiB libres** después de las pruebas. Solo se retiraron los contenedores disposable creados para esta validación; los servicios persistentes y otros proyectos no se modificaron.
- No se realizaron llamadas reales a Gemini. El árbol continúa sin commit, GGA, push, PR, merge, CI remoto, despliegue o producción.

La corrección conserva el comportamiento histórico: el warmup interno nunca escribe historial, mientras que una solicitud autenticada ordinaria sí puede persistirlo. La admisión contabiliza la cola real y las reservas transitorias dentro de una operación atómica; no mantiene un contador paralelo susceptible de desincronización. El p95 representativo continúa pendiente antes de producción.

## Fase N — resolución de los cinco bloqueantes de la auditoría independiente

El PM autorizó corregir los cinco bloqueantes P1 detectados por la revisión Codex-only. Se mantuvo el alcance local: no se ejecutó GGA, no se creó commit, no se realizaron llamadas reales a Gemini y no se modificaron M4/M5.

| Bloqueante                                                                             | Corrección                                                                                                                                                                                                                                       | Regresión verificable                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| El consumo de capability podía cruzar la expiración durante la consulta del usuario.   | El consumo usa Lua con `TIME` del propio Redis y rechaza el `jti` cuando `now >= expiresAt` antes de ejecutar `SET NX PX`; la validación sigue fallando cerrado ante Redis no disponible.                                                        | `internal-capability.test.ts`: replay secuencial/concurrente, Redis no disponible y expiración durante lookup.                   |
| La reserva de cola podía vencer mientras `queue.add` seguía bloqueado.                 | La reserva mantiene una lease renovable hasta confirmar el enqueue; el productor tiene timeout/reintentos acotados y la lease se libera en `finally`. Se corrigió además el nombre de cola para cumplir la restricción de BullMQ de no usar `:`. | `meal-plan-warmup.test.ts`: capacidad, concurrencia, TTL, renovación y liberación.                                               |
| Redis configurado pero caído podía dejar BullMQ esperando indefinidamente.             | Se separaron conexiones productora/bloqueante, se desactivaron reintentos de conexión, se añadió readiness bounded y limpieza de recursos fallidos; el warmup devuelve `null` y la ruta falla cerrado.                                           | `meal-plan-warmup.test.ts` con Redis inaccesible: **1/1 PASS** dentro del presupuesto de readiness y sin errores no controlados. |
| Signup permitía evadir el límite cambiando el email.                                   | Se conservó el bucket por objetivo y se añadió bucket secundario global o por cliente confiable según ingress.                                                                                                                                   | `auth/signup/route.test.ts`: llamadas target + secondary y rechazo del bucket global.                                            |
| Password reset update podía bloquear a todos los usuarios desde el bucket `anonymous`. | El bucket primario usa el hash del token y el secundario limita globalmente o por cliente confiable; nunca se usa el token en claro ni una cabecera forwarded arbitraria.                                                                        | `password-reset/update/route.test.ts`: token-scoped + secondary y rechazo del bucket global.                                     |

### Evidencia de validación de la Fase N

- Vitest disposable PostgreSQL/Redis: **1146 PASS / 1 skipped**, 121 archivos; migraciones 001–019 y ledger completos.
- Admisión Redis disposable: **5/5 PASS**; readiness con Redis inaccesible: **1/1 PASS**.
- Playwright sobre PostgreSQL/Redis disposable y lanes loopback separadas: **5/5 PASS** — M5 U3 **2/2**, M5 U4 **1/1**, M6 **2/2**.
- TypeScript: PASS. Build Next.js: PASS. ESLint: PASS con el warning histórico de `frontend/src/next.config.test.ts`. Prettier dirigido, `git diff --check` y secret scan: PASS.
- Los contenedores disposable fueron retirados. Espacio libre posterior: aproximadamente **11 GiB**. No se modificaron contenedores persistentes ni otros proyectos.

La auditoría independiente posterior a esta fase aún es obligatoria antes de solicitar GGA. El p95 representativo continúa pendiente para producción.

## Fase O — correcciones de precisión tras la segunda auditoría independiente

La segunda revisión Codex-only encontró cuatro defectos en la implementación de la Fase N. Se corrigieron dentro del mismo alcance autorizado, sin GGA, commit, Gemini ni operaciones remotas.

| Hallazgo                                                                     | Corrección                                                                                                                                                                                        | Evidencia                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| El script Lua de capability leía `ARGV[2]` aunque `expiresAt` era `ARGV[1]`. | Se corrigió el índice y se reforzó la comparación de firma canónica para rechazar variantes Base64URL no canónicas.                                                                               | `internal-capability.test.ts`: firma alterada, argumento `expiresAt` y replay. |
| La renovación de lease ignoraba un resultado `false`.                        | El estado `leaseLost` se propaga; si se pierde durante el enqueue, el job se elimina best-effort y la operación devuelve fallo cerrado. La conexión productora tiene timeout/reintentos acotados. | `meal-plan-warmup.test.ts` y prueba disposable de admisión.                    |
| `client.connect()` no tenía un límite explícito de readiness.                | Se añadió un timeout de readiness alrededor de la conexión base, con desconexión y descarte del cliente cuando vence.                                                                             | Redis inaccesible: **1/1 PASS** sin errores no controlados.                    |
| El cleanup no recuperaba el singleton Redis de admisión.                     | Se desconecta y elimina el cliente, la promesa y el estado de indisponibilidad; se permite recuperación posterior con una ventana corta de backoff.                                               | Flujo de reserva/liberación y readiness disposable: PASS.                      |

### Evidencia de la Fase O

- Vitest disposable PostgreSQL/Redis, ejecutado secuencialmente para evitar interferencia entre fixtures de integración: **1146/1146 PASS**, con 1 prueba env-gated omitida.
- Vitest dirigido de capability, rate limiting y autenticación: **16/16 PASS**; pruebas Redis de admisión: **5/5 PASS**; readiness Redis caído: **1/1 PASS**.
- TypeScript, ESLint y build Next.js: PASS. ESLint conserva únicamente el warning histórico de `frontend/src/next.config.test.ts`.
- No se ejecutaron nuevas llamadas reales a Gemini. Los contenedores disposable fueron retirados y el almacenamiento permaneció alrededor de **11 GiB libres**.

La revisión independiente de este árbol debe repetirse antes de solicitar GGA. El p95 representativo sigue pendiente antes de producción. Permanece como riesgo menor de trazabilidad que `password-reset/request` use el bucket anónimo conservador al registrar `requested_ip_hash` cuando no existe ingress confiable; no afecta la autorización ni el consumo del token.

## Fase P — correcciones adicionales tras la auditoría independiente final

La auditoría independiente posterior a la Fase O detectó cinco defectos nuevos. Se corrigieron exclusivamente dentro del alcance de seguridad y confiabilidad M6, sin GGA, commit, Gemini ni operaciones remotas.

| Hallazgo                                                                                             | Corrección                                                                                                                                                         | Regresión verificable                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| El `jobId` autenticado podía contener cuatro segmentos separados por `:` y ser rechazado por BullMQ. | El identificador conserva tenant, usuario y request server-side en el formato compatible con BullMQ; la reserva Redis mantiene su propio identificador único.      | TypeScript, build y prueba disposable de admisión Redis: **5/5 PASS**.                    |
| La pérdida de lease después del enqueue no interrumpía la espera del resultado del job.              | La renovación propaga una señal de pérdida durante todo `waitUntilFinished`; ante pérdida se elimina el job best-effort y la operación falla cerrado.              | `meal-plan-warmup.test.ts`; readiness y admisión disposable: **5/5 PASS** y **1/1 PASS**. |
| Capability Redis podía quedar indisponible permanentemente después de un fallo transitorio.          | El cliente fallido se desconecta, se descarta y usa una ventana corta de backoff; después puede recuperarse.                                                       | `internal-capability.test.ts`: **5/5 PASS**; Redis no disponible falla cerrado.           |
| Rate limiting Redis podía quedar permanentemente en fallback tras un error transitorio.              | El singleton se descarta, aplica backoff corto y vuelve a conectar después; los límites compartidos siguen fail-closed mientras el almacenamiento es indisponible. | `rate-limit.redis.test.ts`: **4/4 PASS**, incluida recuperación tras fallo transitorio.   |
| Readiness del Redis de admisión podía depender de una conexión sin límite explícito.                 | La admisión usa el helper de readiness acotado, desconecta el cliente al vencer y permite recuperación posterior.                                                  | Redis inaccesible: **1/1 PASS** dentro del presupuesto y sin errores no controlados.      |

### Evidencia de validación de la Fase P

- Runtime: Node `v22.22.3` mediante nvm.
- Vitest base secuencial del árbol corregido: **1129 PASS / 18 skipped**, 121 archivos. Los skips corresponden a escenarios env-gated sin servicios disposable en esa ejecución.
- Vitest dirigido de capability, warmup, autenticación y rate limiting: **45 PASS / 6 skipped**; la prueba Redis de recuperación: **4/4 PASS**.
- Redis disposable de admisión: **5/5 PASS**; Redis inaccesible: **1/1 PASS**. El contenedor temporal fue retirado al terminar.
- TypeScript: PASS. Build Next.js: PASS. ESLint: PASS con el warning histórico de `frontend/src/next.config.test.ts`. Prettier dirigido y `git diff --check`: PASS.
- La evidencia disposable PostgreSQL/Redis y Playwright **1146/1146** y **5/5** de la Fase O permanece como referencia del candidato inmediatamente anterior; la delta de esta fase se validó con las pruebas dirigidas anteriores y no se presenta como una nueva ejecución disposable completa.
- Espacio libre verificado antes de las pruebas: aproximadamente **11 GiB**; no se realizaron limpiezas destructivas y no quedaron recursos disposable de esta operación.
- No se realizaron llamadas reales a Gemini. El p95 representativo continúa pendiente antes de producción.

El candidato sigue **NO-GO PRE-GGA** hasta completar la revisión independiente del árbol final y obtener una autorización específica para cualquier evaluación posterior. No existe autorización de commit en esta fase.

## Fase Q — cierre focalizado de pendientes funcionales y P2

Esta fase cerró únicamente los pendientes reportados por la auditoría independiente anterior. No se amplió el alcance de M6, no se ejecutó GGA, no se creó commit y no se realizaron llamadas reales a Gemini.

### Historial y seguridad del warmup

- La separación ya existente se verificó en `recipe-generate`: una capability warmup válida se resuelve server-side y omite `createRecipeHistory` tanto en generación nueva como en cache-hit.
- La prueba de nueve slots ejecuta nueve generaciones con capability verificada y confirma **cero inserciones** de historial.
- La generación ordinaria autenticada conserva la persistencia histórica; capability inválida, tenant incorrecto y contexto no coincidente siguen rechazándose.
- La prueba adversarial del flujo legacy clasifica el riesgo como **B — riesgo residual sin explotación de autorización demostrada**: `recipeName`, ingredientes y contexto se envían al proveedor como datos controlados por usuario, pero el flujo no expone herramientas, no concede capability y no permite escribir historial anónimo. La validación estructural/restricciones y la ausencia de operaciones privilegiadas mitigan el impacto; no se afirma inmunidad frente a manipulación semántica del modelo.

### Admisión, lease y recuperación

- Límite efectivo de admisión: `WARMUP_MAX_WAITING_JOBS = 10`; fan-out del proveedor: `MAX_WARMUP_GENERATION_SLOTS = 9`; worker BullMQ mantiene concurrencia por defecto `1`.
- La admisión Redis disposable verificó **7/7 PASS**, incluyendo concurrencia con un cupo, TTL, renovación, liberación y reserva duplicada idempotente sin aumentar el ZSET.
- La prueba de lease verifica que perderla durante `waitUntilFinished` interrumpe la espera, elimina el job best-effort y devuelve fallo cerrado; un resultado tardío no se propaga como respuesta válida.
- Capability Redis: recuperación tras fallo transitorio verificada; rate-limit Redis: recuperación transitoria verificada en **4/4 PASS**; readiness con Redis inaccesible: **2/2 PASS** contando la regresión de lease.

### Compatibilidad M5 del endpoint warmup

- Contrato vigente: `POST /api/meal-plan/warmup`, body validado por `MealPlanWarmupSchema`, usuario autenticado con tenant, rate limit compartido; respuesta exitosa conserva `{ calendar, failed, warmedSlots }`.
- Sin autenticación: `401`; almacenamiento compartido de rate limit no disponible: `503` con `Retry-After`; cola/admisión no disponible: error recuperable `500`; fallo del proveedor: respuesta genérica `500`.
- El cache-hit y la ausencia de historial se verifican en el endpoint interno `recipe-generate`; la ruta warmup no introduce escrituras de dominio propias.
- Las regresiones conectadas M5 U3/U4 continúan pasando; no se modificó código M5 fuera del alcance común de seguridad.

### Evidencia final de la Fase Q

- Vitest completo con PostgreSQL/Redis disposable, migraciones 001–019 y ledger verificado, ejecutado secuencialmente: **1154 PASS / 1 skipped**, 121 archivos.
- Playwright con lanes disposable realmente separadas: **5/5 PASS** — M5 U3 **2/2**, M5 U4 **1/1**, M6 **2/2**.
- TypeScript: PASS. ESLint: PASS con el warning histórico de `frontend/src/next.config.test.ts`. Build Next.js: PASS. Prettier dirigido y `git diff --check`: PASS.
- Espacio libre: aproximadamente **9.9 GiB** después de las pruebas; los contenedores disposable propios fueron retirados y no se modificaron servicios persistentes ni otros proyectos.
- Secret scan: PASS. No se ejecutaron llamadas reales a Gemini.

El riesgo legacy queda documentado como residual P2 y no como vulnerabilidad de autorización comprobada. El candidato queda **elegible técnicamente para solicitar GGA**, pero cualquier evaluación o commit requiere una autorización posterior explícita. El p95 representativo continúa pendiente antes de producción.

## Block C — Remaining contract observations

- Explicit annotations were added to embeddings, warmup, today, cooking-intent-preview and meal-plan. The declarations used evolving TypeScript inference; no effective implicit-any runtime defect was established. The annotations use existing domain types and repository return types without changing behavior.
- The M6 RAG adapter captures the request's signal and deadline in `retrieveServerRagContext`; it passes both to `bookChunkRepository.searchChunks`. The generic adapter call in `ragEngine` therefore does not lose cancellation in the teacher path. The forwarding regression now checks identity of both values. Existing PostgreSQL timeout/cancellation integration evidence remains historical; no new real-database cancellation run was performed in Block C.
- Legacy recipe prompt injection is classified **B: residual risk without demonstrated authorization bypass**. Recipe names, ingredients and request profile fields are client-controlled; persisted profile/inventory and retrieved text may also contain untrusted content. These are interpolated into the prompt, so malicious instructions may affect recipe prose. No absolute resistance is claimed.
- Authorization, tenant/user history scope, capability validation and persisted dietary restrictions are determined server-side, not from model output. Generated results can create recipe history for the authorized caller, but do not autonomously authorize inventory/session mutations. Deterministic ingredient restrictions run before history/cache writes, including cache hits. Browser RAG chunks are ignored; citations originate from server retrieval.
- Four added mocked adversarial cases cover English/Spanish instruction attacks and delimiter spoofing with prohibited provider output, plus anonymous RAG authorization spoofing. These prove the tested deterministic boundaries, not real-model instruction compliance or complete semantic safety. No real Gemini requests were made.
- Acceptance condition: retain server-side authorization and deterministic restriction checks; do not treat generated recipe text as executable commands or authorization. Broader multilingual semantic coverage and real-model adversarial evaluation remain residual concerns, outside this bounded block.

## Final integral validation — acceptance incomplete

- Initial candidate: `26850ca00db7339c84cff2ca40ea15e732994d92`, 77 staged files, Node 22.22.3 confirmed in parent and child.
- Disposable PostgreSQL 16/pgvector and Redis used only on loopback with tmpfs; migrations 001–019 applied through separated bootstrap/migration lanes; ledger verified complete.
- Full sequential Vitest: **1184 PASS / 0 FAIL / 11 SKIP**. Ten skips are the reduced private-socket signup fixture; one is unavailable-Redis readiness. Signup real-schema ran separately: **16 PASS / 0 FAIL / 0 SKIP**. Readiness ran separately: **1 PASS**, with seven cases excluded by the targeted name filter.
- New real-PostgreSQL cancellation tests: **4 PASS**, including existing timeout/abort cases, two concurrent aborted queries observed through `pg_stat_activity` with no matching active backend within 2500 ms, and pool acquisition deadline under 20 occupied connections. This establishes bounded recovery, not instantaneous server cancellation. Socket disposal plus SQL statement timeout remain the effective safeguards.
- Playwright: **5 PASS** (M5 U3 2, M5 U4 1, M6 2); its standalone web-server harness completed the Next.js build.
- Signup rollback, concurrent canonical-email uniqueness, retry and committed session cookie passed against the complete migrated schema using a non-superuser/non-BYPASSRLS role.
- **Acceptance blocker:** harness grants have not been shown equivalent to the deployed application runtime grants. Signup's four core tables have no RLS by design. Populated tenant/user isolation was tested on five policy tables; four reconciliation child tables have catalog/empty-read coverage only. Do not claim complete application-equivalent RLS acceptance.
- No production access, real Gemini requests, GGA authorization/evaluation, commit or remote Git operation occurred. Representative p95 remains pending before production. This validation does not authorize GGA: recommendation **NO-GO** until the runtime-role equivalence and missing RLS evidence are resolved.

## Definitive local RLS role comparison — B: real difference

- `docker-compose.local.yml` configures `cocinacore_user` as both PostgreSQL initialization user and backend connection identity; `frontend/.env.example` uses the same identity. No active `.env.local` was found in this worktree, so an actually running backend environment was not inferred from the example.
- A read-only catalog query against the existing local PostgreSQL confirmed `cocinacore_user`: SUPERUSER=true, BYPASSRLS=true, INHERIT=true, no role memberships. The observed `users` and `tenants` tables are owned by that identity and have no RLS. The inspected local database did not contain the M6 policy tables; no migration or state change was made there.
- The real-schema harness instead creates `signup_runtime` with NOSUPERUSER, NOBYPASSRLS and NOINHERIT, and explicit table grants. Its passing isolation tests are not evidence of equivalent runtime privileges. Superusers bypass even FORCE ROW LEVEL SECURITY.
- `db.ts` connects with DATABASE_URL and does not downgrade role. Recipe and cooking-session repositories set tenant/user context transaction-locally, which avoids session context leakage after commit/rollback, but does not make RLS effective for a superuser. Application SQL predicates remain separate controls, not an equivalent RLS guarantee.
- Classification: **B, local equivalence FAIL** for the configured local stack; **C, production configuration not demonstrated**. No production connection or credential inspection occurred. Correcting runtime role provisioning, grants and compatibility requires a separate PM decision; no permission or authentication architecture change was attempted.
- Prior functional results (Vitest 1184 PASS, Playwright 5 PASS, real-schema signup 16 PASS, PostgreSQL cancellation 4 PASS) remain functional evidence, not proof of runtime-equivalent RLS. No suites were repeated solely to obscure this configuration difference. Recommendation remains **NO-GO for GGA** until the runtime role decision is resolved and tested on populated policy tables.

## Restricted runtime correction — disposable acceptance

- `scripts/provision-runtime-role.sql` defines the canonical `cocinacore_runtime_rls` ACL matrix; the same file is executed by the full-schema harness. No test-only replacement grants are used. LOGIN is enabled; superuser, BYPASSRLS, CREATEDB, CREATEROLE, replication, ownership and memberships are absent. Explicit DML/function grants exclude administrative and immutable-row mutation privileges.
- Final real-schema restricted-role integration: **21 PASS / 0 FAIL / 0 SKIP**, with migrations 001–019 and ledger checksums, provisioning twice and rejection of a privileged role fixture. All nine RLS tables contain real rows, including reconciliation children; cross-tenant/user and missing-context access fails. A one-connection pool is reused after COMMIT and ROLLBACK without tenant context contamination. Signup atomicity and concurrent duplicate handling remain valid.
- M5 session lifecycle and concurrent/idempotent reconciliation, M6 teacher context, inventory and culinary-profile repository consumers pass under the restricted role. Redundant FOR UPDATE reads on immutable reconciliation/claim rows were removed because they required UPDATE ACL; aggregate locks/unique constraints remain. No grants were widened to permit immutable-row UPDATE.
- Legacy tables without RLS still rely on application authorization/predicates, including signup; this does not imply universal SQL tenant isolation. See `docs/ops/postgresql-runtime-rls.md` and the provisioner's per-table matrix.
- No persistent local role or credential was changed. The existing service belongs to the main worktree and lacks M6 tables: activation requires a separately approved migration/connection switch and smoke test, not an automatic change here. Production remains unverified.
- Decision: restricted-role design and disposable compatibility **PASS**. Persistent local activation remains pending; do not describe the existing configured superuser connection as corrected or equivalent. No GGA or commit is authorized by these results.

## Isolated HTTP runtime RLS smoke

- The smoke is candidate-bound but does not embed its own candidate identity. Calculate the expected staged tree immediately before invocation, then pass it out-of-band:

  ```sh
  EXPECTED_TREE="$(git write-tree)" && \
    M6_EXPECTED_TREE="$EXPECTED_TREE" \
    node scripts/test-m6-http-smoke.mjs
  ```

  `argv[2]` may be used instead of `M6_EXPECTED_TREE`. The value must be exactly 40 hexadecimal characters. The script recomputes `git write-tree`, compares it with the supplied tree, counts staged paths from the current index, rejects unstaged or untracked paths, snapshots and rechecks the index bytes/digest, and records the actual candidate tree/count in its disposable evidence. Missing or malformed identity fails before the disposable runtime starts. Do not copy a prior SHA or staged count into this checklist; the invocation output is the only current candidate evidence.
- A successful run is freshly built in a private copy with Node 22.22.3. PostgreSQL/Redis disposable uses temporary generated credentials, loopback ports and tmpfs; migrations 001–019 and ledger are verified before the approved runtime role provisioner runs. The local provider stub is the only permitted LLM endpoint.
- Final execution: **15 assertion groups PASS, 0 FAIL, 0 SKIP**. HTTP signup succeeded for two tenants; injected membership/commit failures returned no cookie and left no partial records. Restricted-role SQL checks confirmed ENABLE/FORCE RLS on nine tables, denied administrative privileges and foreign/missing-context access.
- Actual HTTP database trigger observations recorded `current_user=session_user=cocinacore_runtime_rls`; five same-backend post-scope authentication observations confirmed transaction-local context cleanup. HTTP recipe writes and cross-tenant denial passed; M5 start/read/replay/pause/resume passed; M6 teacher returned an explanation from the local stub with no business-state mutation.
- Two earlier executions failed due to test-fixture defects: invalid day labels and an ordering assumption on a table without `id`. Both fixtures were corrected; no candidate application code changed. Each run removed its own temporary resources.
- The persistent local runtime remains unmigrated and is not represented by this disposable smoke. Production authorization, configuration and p95 remain separate gates. No real Gemini, GGA, commit or remote operations occurred.
