# F56 — Estado de almacenamiento en el dashboard

Base: `789aeca8db24febe00a1bd202b28b9a8118ebddb`.

Objetivo: mostrar la salud S3/RustFS usando el chequeo público existente, sin crear otra operación ni modificar APIs, acceso o infraestructura. El panel presenta cuatro tarjetas y distingue degradado de sin datos, incluso con HTTP 503 válido o almacenamiento no informado.

Alcance: presentación del estado del sistema, adaptador de lectura de la respuesta pública, pruebas unitarias con respuestas simuladas y expectativa de número de tarjetas E2E. No ejecutar operaciones privilegiadas, credenciales, cambios de permisos, despliegues ni pruebas contra servicios reales.

## Evidencia local
- 27/27 pruebas focalizadas (respuesta pública de salud, adaptador S3 y resumen), PASS.
- ESLint focalizado y TypeScript, PASS.
- Build Next.js, PASS; aviso preexistente de deprecación de Sentry.
- Sin cambios a endpoints ni controles de acceso; respuestas públicas simuladas para todas las nuevas pruebas. Ajuste de expectativa E2E a cuatro tarjetas; la aceptación autenticada real permanece pendiente.
