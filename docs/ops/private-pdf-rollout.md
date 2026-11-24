# CocinaCore Bistró — Habilitación de PDF privados

Estado: candidato funcional; **no habilitado en el Docker original**. Este procedimiento es para el operador autorizado, con respaldo verificable y el candidato revisado.

## Dependencias
- La PR #153 (catálogo global) debe estar integrada o mantenerse como base explícita de la PR privada.
- La migración nueva `025_private_tenant_pdf_creation.sql` requiere todas las migraciones anteriores y la atestación 024 en estado `active`; no modifica SQL histórico 020.
- `frontend/scripts/activated-capabilities-025-inventory.sql` y el contrato de la migración están fijados mediante SHA-256. No ejecutar SQL suelto ni alterar permisos manualmente.
- El almacenamiento de libros personales es independiente de la biblioteca global.

## Activación ordenada
1. Confirmar CI y revisión de la PR, checksum del commit, esquema 024, estado del volumen y respaldo restaurable de PostgreSQL y RustFS. No tocar el VPS compartido u otras aplicaciones.
2. En RustFS crear **un bucket privado separado** y un IAM de servicio con `s3:PutObject` y `s3:DeleteObject` limitados a `arn:aws:s3:::TENANT_BUCKET/tenant-pdfs/*`. No reutilizar la credencial ni el bucket de los PDF globales. Ver `docs/ops/tenant-pdf-storage.md`.
3. Guardar las tres variables `S3_TENANT_BUCKET`, `S3_TENANT_ACCESS_KEY_ID` y `S3_TENANT_SECRET_ACCESS_KEY` en el almacén de secretos o archivo `CC_APP_ENV` protegido (nunca en Git/chat/frontend). El compose de producción las admite como opcionales: si faltan, la API responde 503 y no crea documentos.
4. Verificar **sin escribir objetos** que la identidad S3 privada no puede acceder al bucket global ni listar objetos ajenos. Probar escritura y eliminación solo con un archivo sintético tras autorización operacional.
5. Aplicar 025 por el migrador canónico en la vía de migraciones autorizada; luego ejecutar verificación completa del ledger y atestación 025. No ejecutar sobre la base actual hasta cerrar el preflight y el respaldo.
6. Construir o desplegar la imagen de aplicación aprobada por el procedimiento normal y comprobar sus cinco servicios saludables. Evitar imágenes y contenedores temporales persistentes.
7. Probar en cuentas de prueba aisladas: anónimo 401, alta de PDF, extracción e indexación, RAG con cita `tenant_pdf`, límites Home 5 y Professional 15, duplicados 409, aislamiento A/B, eliminación, y recuperación tras fallo simulado de DB/S3.
8. Solo dar el bloque por aceptado cuando las pruebas E2E sean verdes y el PDF real aparezca en la biblioteca privada sin aparecer en la de otros hogares.

## Reversión y riesgos
- Sin configuración de S3, la API no acepta nuevas cargas y no debe marcar éxito. No volver a usar credenciales globales.
- PostgreSQL y S3 no comparten transacción: el backend intenta borrar el archivo si falla el guardado en DB. Si esa limpieza falla, emite el evento `private_pdf_upload.cleanup_failed`; reconciliar objetos huérfanos bajo supervisión.
- La eliminación de un PDF efectúa primero el borrado del objeto privado para no dejar el contenido accesible y después borra metadatos. Una falla de DB en medio puede dejar un registro sin objeto; el usuario debe poder reintentar y el operador debe conciliarlo. No borrar masivamente objetos sin evaluación específica.
- No se soporta OCR: los PDF sin texto extraíble se rechazan.
