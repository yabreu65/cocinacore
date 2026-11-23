# CocinaCore Bistró — Área 5 · implementación de experiencias transversales

## Aprobación y base
Propuesta odd/design/area5/revision-area5.html aprobada por el propietario.
Área 5 consiste en cinco estados/recorridos de rutas existentes, no en nuevas pantallas.
Base: main tras PR #151 (046ee4002e11dc18d401ad07e7040b2b4bd17b74).

## Implementación acotada
1. /app: orientación hacia cocinar ahora, planificar y compras, sin duplicar las herramientas del recetario.
2. /meal-planner: estado de generación con mensaje sincero (sin porcentaje inventado), recuperación de errores con reintento de lectura que no genera otro menú; el flujo de generación original sigue a cargo de la API existente.
3. /shopping-list: estado vacío y acceso directo al formulario de ingredientes o planificador.
4. /shopping-list: cantidad sugerida separada de cantidad realmente comprada, entrada numérica real obligatoria y selección explícita de unidad, validación compartida y confirmación explícita antes del POST.
5. Resultado de compra e inventario únicamente después de recibir respuesta exitosa del servidor.

## Seguridad y compatibilidad
- Sin endpoints nuevos, migraciones, modificación de roles, reglas de autorización o Docker.
- No se contabiliza una cantidad sugerida como compra real sin intervención del usuario.
- La validación del navegador es informativa; el servidor conserva todas las verificaciones de unidad, cantidad, idempotencia, tenant y estado del artículo.
- El reintento del planificador ejecuta de nuevo únicamente lectura del plan existente.
- No se prometen progreso, duraciones, estados de servicio o guardados no confirmados.

## Pruebas
- Pruebas unitarias de entrada vacía, cero, negativos, unidad incompatible, cantidad insuficiente y cantidades válidas.
- Prueba E2E de compra agrupada actualizada para exigir entrada manual y asegurar ausencia de POST ante cantidad insuficiente.
- Al finalizar registrar TypeScript, ESLint, suite completa y CI/E2E GitHub.

## Validaciones locales completas
- TypeScript --noEmit: aprobado.
- ESLint del alcance: aprobado.
- Vitest: 180 archivos aprobados, 19 omitidos; 2283 pruebas aprobadas, 123 omitidas, 0 fallos.
- E2E ajustada para lista vacía, cantidades sin rellenar y rechazo de compra insuficiente sin emitir POST.
- Comparador conceptual previamente aprobado: disponible en el enlace de revisión del Área 5.
- La CI de GitHub y la verificación de E2E integrada se requieren antes del merge.
