# CocinaCore Bistró — UX Área 1 · Pantalla 4: Detalle de receta

## Base y alcance
- Base exacta: feat/cc-ux-recipe-assistant-mobile-first, commit e2fb6ccc1990f6f1ce5c651fb6bb5c087da9d634 (PR #145, calidad y E2E de GitHub aprobados, todavía abierta).
- Rama del candidato local: feat/cc-ux-recipe-detail-mobile-first.
- Alcance: presentación de /recipes/[id] en RecipeDetailClient.tsx, robustez del comprobador de botones ante iconos decorativos en su prueba existente, y nueva especificación Playwright UX.
- Sin cambios de APIs, esquemas, roles, escritura, inventario, versionado, importación ni manejo de estados.

## Diagnóstico y propuesta
- El detalle anterior presentaba título, ingredientes, costo, instrucciones e historial en una sola tarjeta, sin jerarquía clara ni acción de cocina prioritaria.
- Nueva cabecera Bistró: título legible, categoría/etiquetas, porciones originales y acción «Cocinar ahora» que utiliza el flujo existente de preparación mediante cooking-intent.
- Editar y Archivar/Desarchivar mantienen exactamente sus acciones y bloqueos durante cambios.
- Ingredientes con nombre y cantidad separados, sin cambiar orden ni cantidades; ajuste de porciones existente; aclaración de cantidades parciales y costo.
- Pasos y notas en tarjeta independiente con lectura cómoda y saltos de línea intactos. No se interpreta ni inventa numeración.
- Historial visible en sección secundaria, con enlace original y restauración con confirmación existente.
- Móvil 390×844 en columna; escritorio 1440×900 con ingredientes y pasos en columnas.

## Comparación y pruebas
- Comparador local: http://127.0.0.1:4397/detalle.html. Capturas de la UI real, Antes y Después, con la misma receta ficticia «Pasta cremosa con champiñones», dos versiones y siete ingredientes.
- Navegador: cero errores JS y cero desbordamiento horizontal en ambas versiones; al duplicar de 4 a 8 porciones, 300g -> 600g; abrir «Editar» mantiene editor; ninguna escritura.
- Rutas temporales retiradas, servidores Next dev detenidos y cachés generadas eliminadas. Solo permanecen las capturas estáticas y la galería.
- TypeScript y ESLint: PASS. Focal de 37 pruebas: PASS. Dos pruebas antiguas comparaban literalmente props.children y no detectaban el texto del botón con icono; helper ahora extrae texto recursivamente sin relajar aserciones.
- Nueva especificación E2E recipe-detail-mobile-ux.spec.ts para acción de cocina, porciones, costo, historial, cancelación de restauración, edición, archivado y escritorio; pendiente de CI si se publica la PR.
- Regresión completa y hook nativo: consultar evidencia final del commit.

## Estado
- PENDIENTE DE APROBACIÓN VISUAL DEL PROPIETARIO. No publicar PR, integrar ni desplegar todavía.
- No se consultaron recetas privadas, no se modificaron datos reales y no se construyeron imágenes Docker.
