# F56 — Ingesta completa dentro del transporte existente

Base: 3a5e00c0ca888de25cd5ef8223f73c49677f46db. Issue #124.

Incidente: el propietario no puede cargar su libro de 264 páginas y 31 393 957 bytes porque el cliente rechaza más de 160 fragmentos. Medición local de PDF.js sin proveedor: 139 páginas con texto, 125 sin texto extraíble, 308 fragmentos incluyendo páginas cortas. No se publican textos del libro.

Decisión: no introducir colas, nuevos endpoints, migraciones ni cambios de permisos. Conservar la ingesta existente, con preflight por tamaño real del PDF, metadatos y cota superior de JSON para cada vector de 1536 dimensiones. El límite vigente de Nginx es 50 MiB; se reserva 1 MiB para encabezados y framing. El presupuesto también mantiene el número de parámetros del INSERT existente por debajo del límite del protocolo. Rechazar antes de consumir cuota si no cabe. Verificar tamaño real antes de enviar multipart.

Procesar todas las páginas, preservar texto corto y cola, generar todos los vectores en lotes existentes, presentar progreso y advertir explícitamente la cobertura sin OCR. Mantener una sola carga del original y un solo índice en la transacción existente; no declarar éxito si el recuento confirmado difiere. No prometer indexación de páginas sin texto; no implementar OCR ni persistencia de trabajos en esta unidad.

Alcance: cliente de carga y pruebas simuladas, sin tocar API protegida, roles, RLS, base de datos, almacenamiento ni secretos. No se ejecuta ingesta real, que corresponde a la aceptación manual del propietario. Documentos cuyo PDF más índice exceda el transporte requieren un diseño posterior, no un aumento arbitrario de límites.

## Evidencia local
- Vitest focalizado: 29/29 PASS (tres archivos).
- ESLint, TypeScript y build Next.js: PASS.
- Prueba offline con PDF original y proveedor simulado: 264 páginas, 139 con texto, 125 sin texto extraíble, 308 fragmentos, 4 lotes, progreso 308/308. Archivo: 31 393 957 bytes; cota de transporte 43 930 538 bytes; multipart simulado estimado 40 927 537 bytes; presupuesto 51 380 224 bytes. No se envió el libro a ningún servicio ni se guardaron datos.
