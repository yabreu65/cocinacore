# M6 U0 — Profesor de Cocina Inteligente

**Estado:** especificación oficial de producto y técnica aprobada para desarrollo local.

**Procedencia:** decisiones explícitas del PM en la orden de ejecución local recibida el 30 de octubre de 2026. Estas decisiones son nuevas para M6; no se presentan como requisitos históricos del repositorio.

**Base:** M5 cerrado localmente en `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`.

## Decisión ejecutiva

M6 añade un profesor culinario contextualizado exclusivamente a una sesión de cocina existente. El profesor explica, orienta y responde dudas acotadas sobre la receta/version y el paso operativo actual. No es un chat culinario general ni un agente autónomo.

La autoridad de negocio permanece en los contratos deterministas de M5: autenticación, tenant, restricciones, alergias, estado de sesión, inventario, planificación, consumo e idempotencia. El profesor no ejecuta comandos de dominio ni modifica datos.

## Objetivo y usuarios

### Objetivo

Reducir la fricción durante la preparación de una receta ofreciendo explicaciones comprensibles, verificables y oportunas sin alterar la operación de cocina ni convertir inferencias de IA en hechos del sistema.

### Usuarios objetivo

- Miembros autenticados de tenants `household`.
- Usuarios de tenants `professional` únicamente donde ya exista el flujo operativo soportado.

Los dominios profesionales todavía no implementados no forman parte de M6.

## Casos de uso aprobados

1. Explicar el paso operativo actual.
2. Definir una técnica culinaria mencionada en la receta.
3. Explicar el orden de operaciones.
4. Describir señales visuales o sensoriales esperables, dejando clara la incertidumbre.
5. Señalar errores frecuentes sin afirmar seguridad alimentaria o médica.
6. Responder dudas sobre la receta/version activa y la sesión actual.
7. Mostrar fuentes RAG comprobables cuando la respuesta use conocimiento recuperado.
8. Reconocer que no hay evidencia suficiente y solicitar una aclaración segura.

## Capacidades prohibidas

- Chat culinario general fuera de una sesión.
- Persistir transcripciones completas, preguntas o respuestas.
- Escribir preguntas o respuestas en logs o analítica.
- Modificar recetas, versiones, planes, inventario, consumo o progreso.
- Proponer sustituciones automáticas.
- Confirmar por sí solo la seguridad de un alimento o preparación.
- Resolver alergias o restricciones con criterio generativo.
- Fabricar citas o tratar una respuesta generada como una orden.
- Acceder directamente a la base de datos desde el modelo.
- Usar herramientas de escritura o comandos de dominio.

## Contrato conceptual

### Entrada del profesor

La entrada se deriva del servidor y debe contener únicamente:

- usuario autenticado, tenant y autorización ya verificados;
- sesión de cocina autorizada;
- receta y versión exactas;
- paso operativo actual;
- ingredientes relevantes;
- porciones;
- restricciones deterministas aplicables;
- estado conocido o desconocido de cantidades;
- referencias de conocimiento autorizadas;
- pregunta acotada o acción pedagógica permitida.

El cliente nunca tiene autoridad para elegir tenant, usuario, receta/version o sesión.

### Salida del profesor

La salida debe validarse server-side y representar únicamente una explicación:

```ts
type TeacherEvidenceStatus =
  | "supported"
  | "partial"
  | "unknown"
  | "unavailable";
type TeacherResponseKind =
  | "explanation"
  | "clarification"
  | "safe_refusal"
  | "provider_unavailable";

interface CookingTeacherResponse {
  kind: TeacherResponseKind;
  answer: string;
  evidence: TeacherEvidenceStatus;
  citations: Array<{ title: string; page: number | null }>;
  limitations: string[];
  sessionMutation: "none";
}
```

Las respuestas fuera de esquema, sin evidencia suficiente o con una afirmación no permitida se degradan a incertidumbre o rechazo seguro.

## Modelo de contexto

El contexto se construye server-only y distingue:

| Clase                             | Ejemplos                                                      | Autoridad                     |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| Hecho determinista                | paso actual, recipe/version, porciones, alergias configuradas | Aplicación y repositorios     |
| Estado explícitamente desconocido | cantidad sin unidad, inventario no verificado                 | Aplicación                    |
| Conocimiento recuperado           | técnica o principio de un libro autorizado                    | RAG y cita                    |
| Inferencia pedagógica             | explicación derivada para ayudar a comprender                 | Proveedor, siempre etiquetada |

El modelo de pasos separa:

- **Pasos operativos persistidos de M5:** gobiernan el progreso real de la sesión.
- **Etapas pedagógicas derivadas:** explicaciones temporales para el paso actual.

Una receta con instrucciones no estructuradas continúa tratándose como un único paso operativo. Las etapas pedagógicas no se convierten automáticamente en pasos oficiales ni avanzan la sesión.

## Seguridad y privacidad

- Autorización y aislamiento se validan antes de construir el contexto.
- No se exponen secretos, datos de otros tenants ni datos innecesarios.
- Las alergias y restricciones se resuelven con reglas deterministas.
- El profesor nunca confirma seguridad alimentaria, médica o de alergias.
- No se guardan transcripciones, preguntas ni respuestas en logs o analítica.
- El feedback se limita a útil/no útil y categorías controladas.
- No se envía contenido privado a analítica externa.
- Los errores del proveedor no bloquean la sesión.

## Límites de IA

Los valores iniciales son configurables por entorno y deben medirse:

- objetivo de latencia p95: 8 segundos;
- timeout máximo inicial: 15 segundos;
- rate limiting por usuario y tenant;
- límite configurable de tokens por respuesta;
- presupuesto de IA configurable;
- respuesta segura cuando Gemini no esté disponible.

Los mocks no prueban rendimiento real. El cumplimiento de p95 y consumo debe medirse con una evaluación separada y evidencia de proveedor real controlada, sin convertirla en requisito de todas las pruebas automatizadas.

## Arquitectura y dependencias

- Backend existente de Next.js; no se agrega microservicio.
- Adaptador server-only sobre Gemini existente.
- Contexto determinista separado del proveedor.
- Validación estricta antes y después del proveedor.
- RAG y citas existentes como fuente autorizada.
- Redis existente para rate limiting y cache únicamente si el contrato lo requiere.
- No se añade dependencia de npm para U0–U5.
- No se añade migración de transcripciones.
- No se añade migración de pasos sin propuesta técnica y aprobación específica.

Componentes reutilizables:

- `frontend/src/lib/cooking-session.ts`;
- `frontend/src/lib/cooking-intent-preview.ts`;
- repositorios de sesiones y consumo real;
- perfil culinario y restricciones;
- recetas/versiones persistidas;
- `frontend/src/lib/recipes/server-rag-context.ts`;
- citas RAG;
- normalización de cantidades;
- `frontend/src/lib/rate-limit.ts`;
- harness disposable de Playwright.

## Alcance U1–U6

| Unidad | Resultado                                  | Criterio de aceptación principal                                                                                  |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| U1     | Constructor server-only de contexto seguro | Contexto tenant-safe, determinista, sin escrituras y con desconocidos explícitos.                                 |
| U2     | Adaptador del profesor sobre Gemini        | Salida Zod estricta, citas verificables, prompt injection rechazado, timeout/rate limit/token budget y fail-safe. |
| U3     | UI text-first dentro de la sesión          | Responsive, accesible, instrucciones oficiales separadas de explicaciones, sin mutaciones ni avance implícito.    |
| U4     | Feedback mínimo                            | Útil/no útil y categorías controladas; sin transcript, preguntas, respuestas ni nueva migración.                  |
| U5     | Hardening y evaluación                     | Pruebas de seguridad, aislamiento, incertidumbre, adversariales, accesibilidad, E2E y regresión M5.               |
| U6     | Cierre local                               | Evidencias, métricas, riesgos, integridad Git, estado de migraciones y checklist posterior.                       |

## Estrategia de pruebas

### U1–U2

- unitarias puras con fixtures;
- autorización y aislamiento multi-tenant;
- recipe/version y sesión incorrectas;
- datos desconocidos;
- alergias y restricciones;
- ausencia de escrituras;
- salida inválida, citas inexistentes y timeout;
- provider mock sin clave Gemini real.

### U3–U5

- accesibilidad de teclado y lectores de pantalla;
- estados de carga, error e incertidumbre;
- reintentos y refresh sin duplicación;
- prompt injection;
- alucinaciones potencialmente peligrosas;
- rate limiting por usuario y tenant;
- E2E Playwright sobre recursos disposable;
- TypeScript, ESLint, build y regresión M5.

## Métricas de aceptación

Se medirán, sin almacenar contenido privado:

- porcentaje de respuestas con evidencia `supported` o `partial`;
- porcentaje de respuestas rechazadas de forma segura;
- tasa de errores y timeouts del proveedor;
- p95 de latencia;
- tokens consumidos por respuesta;
- rate-limit events;
- feedback útil/no útil agregado, si existe mecanismo compatible con privacidad;
- cero mutaciones de dominio originadas por consultas al profesor.

## Riesgos y mitigaciones

| Riesgo                             | Mitigación                                                             | Condición de detención                              |
| ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Alucinaciones o consejos inseguros | Contexto acotado, citas, esquema estricto y fail-safe                  | Respuesta no verificable sobre seguridad o alergias |
| Prompt injection                   | Separar instrucciones del usuario, receta y fuentes; rechazar comandos | El proveedor intenta ejecutar una acción            |
| Fuga tenant                        | Guards server-side, repositorios scoped y pruebas negativas            | Cualquier acceso cross-tenant                       |
| Confusión de pasos                 | Mantener pasos operativos y etapas pedagógicas separadas               | Se requiere mutar progreso para explicar            |
| Coste o latencia                   | Límites configurables, rate limiting y mediciones                      | Se supera presupuesto aprobado                      |
| Privacidad                         | Sin transcript, logs ni analítica textual                              | Se requiere persistencia no aprobada                |
| Falta de proveedor                 | Respuesta segura y sesión operativa intacta                            | La sesión depende de Gemini para avanzar            |
| Recursos locales limitados         | Servicios disposable, sin imágenes grandes ni limpieza destructiva     | Integración amenaza el espacio disponible           |

## Dependencias y límites de entrega

- Base local: M5 `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`.
- Rama M6 independiente; M5 y M4 no se modifican.
- Sin push, PR, merge, CI remoto, despliegue o producción.
- PostgreSQL y Redis disposable para integración/E2E.
- No se reutilizan bases persistentes para pruebas destructivas.
- Hooks y GGA se respetan; cualquier autorización adicional detiene solo la operación que la requiera.

## Cierre U0

U0 queda formalizada con las decisiones del PM y habilita la implementación secuencial de U1–U6 dentro de este alcance. Cada unidad debe cerrarse con evidencia propia; no se arrastran fallos abiertos a la siguiente unidad. Toda nueva migración, permiso, coste, cambio de privacidad o ampliación funcional requiere una decisión separada.
