# F56 — Alinear transporte multipart con límite de ingreso

Base: 43565c6614fb7cca4206f2610f2c657587d08746. Issue #124.

Evidencia: F56 generó 100 + 100 + 100 + 8 embeddings reales con los reintentos de PR #126. POST global-pdfs devolvió 500; Next registró Request body exceeded 10MB. El límite de clonación de middleware en Next 16.4.5 es 10 MiB, mientras que Nginx permite 50 MiB únicamente para esta ruta y 2 MiB para el resto.

Objetivo: alinear el límite de clonación de Next al límite existente del ingreso (50 MiB), conservando margen de 1 MiB del cliente. Mantener middleware, autorización, red privada de la app, Nginx, rutas, cuotas, almacenamiento y base de datos intactos. El límite global interno de Next aumenta, pero el ingreso público sigue acotado por ruta. No exponer directamente el puerto de app.

Aceptación: regresión sintética con implementación real de clonación de Next y multipart de más de 10 MiB: reproducir truncamiento previo y acreditar PDF/índice completos con configuración nueva. No consumir cuota ni ejecutar ingesta real. Sin cambios a producción.

## Evidencia local
- 34/34 pruebas focalizadas, ESLint, TypeScript y build: PASS.
- Regresión usa getCloneableBody de Next instalado: 30 MiB de PDF sintético y 308 vectores JSON. El límite predeterminado trunca y falla el parser; 50 MiB conserva bytes finales e índice exacto. Sin sesión, red, almacenamiento ni proveedores.
