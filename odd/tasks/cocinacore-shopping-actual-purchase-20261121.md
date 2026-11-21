# Compras — cantidad realmente adquirida

- Base (stack): PR #141 @ f9da671502aec037c5284f5eb0e6b274938dd20b; PR #141 merge pendiente de aprobación explícita.
- Objetivo: al confirmar un producto pendiente con cantidad comercial sugerida (p. ej., huevos 26 requeridos, cartón 30 comprado), persistir exactamente la cantidad adquirida en una única compra y transferencia auditada; marcar como compradas todas las filas originales de ese grupo, sin duplicar stock.
- Scope: listado /shopping-list, helper de consolidación, endpoint de confirmación de grupo, repositorio de compra/transferencia, pruebas unitarias y E2E; sin migración ni cambios en menú/Gemini/perfil.
- Contrato: input autenticado con filas fuente y cantidad real; el servidor revalida pertenencia al tenant/usuario, todas las filas pendientes, mismos ingredientes compatibles, cantidad comercial >= requerimiento y coincidencia contra los registros actuales; mutex existente; una sola transacción crea inventario y movement audit, marca todas las filas compradas y apunta a la misma transferencia. No aceptar alternativas sin elegir, unidades incompatibles ni datos ambiguos. Fallos sin cambios parciales; reintentos sin duplicación.
- UI: mostrar sugerencia por producto, campo editable de cantidad real y confirmación explícita. Mantener las operaciones por fila originales como fallback, con detalles de origen.
- Pruebas: 26 huevos comprados como 30; 700 g arroz comprados como 1000g; capacidad de modificar cantidad realmente adquirida; rechazo de menores, alternativos, duplicados, stale, otros tenants; preservación de estado e inventario al fallo; E2E de pantalla.
- Excluye: modificación de compras ya existentes, migraciones, edición de la receta, precio, entregas parciales, idempotencia con solicitudes externas y despliegue. La PR no podrá integrarse antes de PR #141.

## Verificación (candidato local)
- Control nativo: TypeScript y ESLint PASS.
- Vitest total antes del control final: 2.276 PASS / 123 SKIP (179 archivos PASS). Nuevas pruebas de compra e inventario incluidas.
- Tests de repositorio: 26 huevos requeridos => 30 unidades al inventario en una sola compra; 700 g arroz requeridos => 1000 g ingresados; rechazo de cantidad insuficiente, stale, unidad incompatible, filas ambiguas, lock fallido y actualización parcial.
- Tests HTTP: aislamiento tenant/usuario del token; payload estricto; mensajes 400/409; respuesta pública acotada.
- Tests Playwright stub y con PostgreSQL E2E aislado añadidos (se ejecutarán en CI), incluyendo reintento bloqueado y conservación del dato original.
- Lectura de compras agrupa metadatos de inventario por ID sin sumar dos veces un mismo ingreso; comprado 30 se visualiza después de recarga.
- Seguridad de finalización: una compra ya transferida no puede desmarcarse ni eliminar su registro por HTTP; inventario y movimiento son independientes, con auditoría.
- Sin migraciones, sin Docker, sin modificaciones de datos privados ni despliegues.
- Se requieren: CI completo, PR #141 integrada por autorización del propietario y aprobación separada antes del merge/deploy de este bloque.

## Corrección tras CI #44926784145
- PR #141 integrada en main con commit 84d2790b6447e193a38756ce67a8dd9e8deb1dcb; PR #142 retarget a main, sin merge.
- CI manual #44926784145: frontend-quality PASS, E2E 63 PASS / 2 FAIL / 2 SKIP. Dos fallos de Playwright por selectores ambiguos: aviso Next.js role=alert adicional y un segundo campo de cantidad comercial.
- Cambio exclusivo en selectores del E2E de compras: identificar alerta por texto y campo de creación manual por nombre exacto; sin modificar lógica de negocio.
