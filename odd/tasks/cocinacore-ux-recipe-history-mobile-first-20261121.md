# CocinaCore Bistró — UX Área 1 · Pantalla 5: Historial de recetas

## Base y límites
- Base exacta: rama feat/cc-ux-recipe-detail-mobile-first, commit 0eb752f9edc971be6f531e4990a39697ee3e01d8 (PR #146 publicada).
- Candidato aislado: feat/cc-ux-recipe-history-mobile-first.
- Único cambio de producto: frontend/src/app/recipes/history/page.tsx. Se suma la especificación Playwright recipe-history-mobile-ux.spec.ts y este registro.
- No se modifican API, contratos, permisos, lectura de fuentes PDF, importación persistente, definición de historial, bases de datos ni contenedores.

## Problema observado
- El historial anterior tenía de seis a siete acciones por fila sin jerarquía y poca separación entre fecha, nombre y acciones, particularmente a 390px.
- La distinción entre «marcar para consultar» e «importar a Mi recetario» estaba escrita en una introducción larga y era fácil ignorarla.

## Propuesta
- Cabecera verde Bistró compacta con entrada al recetario y a la búsqueda de recetas.
- Nota breve visible: marcar una idea no la convierte en receta persistente. Importar requiere revisión explícita de ingredientes y pasos.
- Selector «Mostrar recetas» con las mismas opciones y URL saved=true; cantidad de resultados y estados de error, carga y vacío claros.
- Lista con tarjetas: fecha, título, descripción breve de hasta 150 caracteres y acciones visibles «Ver detalle», «Importar a Mi recetario» y «Marcar para consultar».
- «Más opciones» agrupa la valoración Me gustó/No me gustó y el botón Eliminar; la eliminación solicita confirmación nativa antes de hacer la llamada existente.
- Mantiene el payload completo de cada propuesta, fuentes, editor de revisión al importar, protección contra operaciones simultáneas, estado guardado, feedback, reintento y bloqueo durante revisión.
- Rejilla de dos columnas en escritorio y una columna en teléfono, sin desbordamiento horizontal.

## Evidencia real con datos ficticios
- Comparación de componentes React/Next reales «Antes/Después», en teléfono 390×844 y escritorio 1440×900.
- Cuatro propuestas de demostración, dos marcadas y dos sin marcar, con resúmenes, fechas e ingredientes ficticios, mismos datos en ambas versiones. Las API se interceptaron para no acceder a recetas ni usuarios reales.
- URL local exclusivamente en la Mac: http://127.0.0.1:4397/historial.html
- Capturas guardadas en ~/.local/share/cocinacore/ux-review/home-20261121/historial-*png.
- Visuales: cero errores JavaScript en consola de página y cero desbordamiento horizontal; cabecera compactada tras la primera revisión para mostrar las acciones principales antes.
- Prueba de navegador sintética real: ver/ocultar detalle, abrir/cancelar importación sin escritura, marcar y filtrar, valoración mediante PATCH simulado, abrir más opciones y cancelar eliminación sin envío DELETE; PASS.
- Ruta temporal ux-review-history y dos servidores de desarrollo retirados. Cachés .next/dev generadas para estas capturas eliminadas. Comparador estático conservado.

## Validación
- TypeScript y ESLint del alcance: PASS.
- Vitest focal del historial/importación: 25/25 PASS.
- Prueba E2E agregada para CI de móvil y escritorio: frontend/e2e/specs/recipe-history-mobile-ux.spec.ts.
- Regresión completa y hook nativo: verificar en salida de validación final.
- Aceptación visual del propietario: PENDIENTE. No push, PR, merge ni despliegue de esta pantalla antes de aprobación.
