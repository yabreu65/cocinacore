# CocinaCore — Compras agrupadas y presentaciones comerciales

- Base: origin/main 2e76fca25bee2c779e09702eeac89a1139eb1502
- Rama aislada: feat/cc-shopping-group-packs
- Objetivo: mostrar un producto por nombre culinario equivalente, sumar cantidades compatibles y sugerir presentación comercial sin modificar los registros originales.
- Alcance: frontend/src/app/shopping-list/ (UI, cálculo puro, pruebas) y este registro ODD. Mantener rutas/API/DB/Planner/Gemini/perfil sin modificaciones.
- Casos de aceptación: Huevo 11 + Huevos 15 = 26 unidades => cartón de 30; Huevo 11 + Huevos 5 = 16 => cartón de 30; arroz seco 700g => paquete de 1kg, 1.3kg => 2 paquetes; g/kg y ml/l compatibles; arroz cocido/crudo no mezclados; distinto estado pendiente/comprado no mezclado; cantidades nulas, ambiguas o de unidades no compatibles no inventan una compra; queso rallado no se confunde con bloque; datos originales, estado, transferencia y borrado por registro continúan intactos.
- Presentaciones automáticas iniciales: huevos cartón de 30; variedades explícitas de arroz seco paquete de 1 kg; harina de trigo y harina de maíz precocida paquete de 1 kg; leche normal cartón de 1 l. Otras presentaciones variables deben declararse como sugerencia sin envase supuesto. Fracciones de productos por unidad redondean hacia arriba.
- No convertir cucharadas a envases comerciales sin referencia verificada. No suponer equivalencias entre pesos y unidades.
- Para productos con varios registros, la ficha consolidada incluye los registros originales plegables y preserva las acciones existentes, sin intentar actualizaciones masivas no atómicas. La cantidad sugerida es una vista, no una escritura a inventario ni una nueva cantidad de stock.
- No hacer borrados, migraciones, despliegues, compras ni escrituras sobre datos del propietario. Git push/merge requieren autorización aparte.

## Evidencia local
- TypeScript `tsc --noEmit`: PASS.
- ESLint de archivos nuevos/modificados: PASS desde `frontend/`.
- Vitest focalizado: 14/14 PASS en dos archivos (incluye 13 nuevas pruebas de consolidación).
- Vitest completo: 2.251 PASS, 123 SKIP, 178 archivos aprobados, 19 omitidos.
- Playwright stub en `frontend/e2e/specs/shopping-list-ui.spec.ts`: comprueba cartón de 30, arroz 1 kg, origen individual y ausencia de POST/PATCH/DELETE; pendiente ejecución en CI.
- Riesgo intencional: las sugerencias comerciales no persisten todavía la cantidad efectivamente comprada, ni alteran los registros existentes o la operación de inventario; se mantiene el flujo individual actual de marcado y transferencia.
