# F56 — Resiliencia del resumen administrativo

Base: `08e75edfd3030945da9634cda18ce2a964925dae`.

Incidente: el resumen devuelve pantalla de error. Logs de F56: owner.metrics.query_failed, unknown_error; salud pública de DB, Redis y almacenamiento OK. El diagnóstico anterior no distingue fallos de configuración, conexión, consulta y resultado. Causa subyacente todavía no acreditada.

Objetivo: mantener la interfaz disponible si falla la lectura de métricas; mostrar cifras desconocidas sin inventar ceros y preservar la protección de acceso existente. Emitir exclusivamente categorías fijas y etapa del fallo en registros del servicio.

Alcance: presentación del resumen, clasificación de errores en el lector existente, pruebas simuladas. No modificar SQL, roles, RLS, sesiones, permisos, conexiones configuradas, datos ni migraciones. No consultar métricas reales fuera del flujo autorizado. La causa subyacente se determinará a partir de evidencia de ejecución, sin debilitar el contrato.

## Evidencia
- 20/20 pruebas focalizadas de métricas y página administrativa, PASS.
- ESLint focalizado, TypeScript y build Next.js, PASS.
- Se conserva la consulta y conexión exclusiva existentes, la comprobación de acceso previa al renderizado y el rechazo de resultados incompletos; no hay consultas alternativas ni ceros inventados.
- La clasificación añade etapa y motivos fijos, sin mensajes de excepción ni credenciales.
- La prueba de interfaz utiliza métricas simuladas. La causa subyacente y la aceptación real de F56 permanecen pendientes.
