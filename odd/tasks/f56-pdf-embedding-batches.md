# F56 — Ingesta PDF: lotes y extracción real

Base: 446fa1a85b1f8a7ac740bb9be481c6bd199e16ea.

Incidente observado: el formulario devuelve indisponibilidad de embeddings; el log registra embeddings.misconfigured. La configuración privada de Gemini y la aceptación real quedan separadas de este cambio de código.

Objetivo: respetar límites vigentes del endpoint de embeddings, preservar orden y correspondencia de páginas, rechazar respuestas incompletas y evitar fragmentos sintéticos. Mantener el límite existente de 160 fragmentos por documento, pero rechazar explícitamente los documentos que lo excedan en vez de truncarlos. No ampliar límites del servidor, permisos, contratos de almacenamiento ni roles. No acceder a credenciales ni ejecutar cargas reales.

Aceptación: pruebas simuladas con 160 fragmentos, límites de caracteres y lote, respuesta inválida, fallo de segundo lote y extracción vacía; conservar compatibilidad del worker PDF.js y su fixture de embeddings. Sin cambios en endpoints, datos, migraciones ni producción.

## Evidencia local
- Vitest focalizado: 28/28 PASS (tres archivos).
- ESLint, TypeScript y build Next.js: PASS.
- No se ejecutó la ingesta real ni se cambió configuración privada.
