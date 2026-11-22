# CocinaCore Bistró — Auditoría UX Área 1 · Mis recetas

## Contexto
- Segunda página del área «Aplicación del usuario»; se trabaja después de la propuesta de Inicio/navegación móvil que el propietario ya aprobó visualmente.
- Base exacta para esta propuesta: rama feat/cc-ux-home-mobile-first, commit d2cb9c2d5ad3ea614a36a9451e18373315a63973, PR #143 pendiente de integración.
- Rama nueva local: feat/cc-ux-recipes-mobile-first; no publicación ni merge hasta evaluación visual del propietario.
- Scope: exclusivamente frontend/src/app/recipes/RecipeLibraryClient.tsx, prueba Playwright de UX y este registro ODD.

## Problemas y criterios
- Listado móvil antes de la mejora: cabecera sin una acción dominante, cuatro selectores visibles en la primera pantalla y tarjetas con múltiples botones dispuestos en columna, sin jerarquía clara.
- Diseño profesional mobile-first manteniendo verde Bistró, tipografía, bordes y navegación común ya aprobada en Inicio.
- Buscar y ver recetas debe ser directo. Estado siempre accesible; categoría y etiqueta están en «Más filtros».
- Tarjetas con título legible, porciones, categorías/etiquetas, ingredientes principales y dos acciones visibles: «Ver receta» y «Preparar esta receta».
- Opciones menos frecuentes «Revisar preparación» y «Añadir a una comida del menú» siguen accesibles mediante «Más opciones».
- Preservar contratos existentes de API, autenticación, ciclo de vida de la receta, historial, editor manual, estado de archivado y creación; sin escrituras automáticas ni cambios en la base de datos.

## Evidencia visual
- Dos renderizados de componentes React/Next originales con el mismo conjunto ficticio de cinco recetas. Tamaños móvil 390×844 y escritorio 1440×900.
- Comparador local en la Mac: http://127.0.0.1:4397/recetas.html. Las capturas están en ~/.local/share/cocinacore/ux-review/home-20261121/recetas-*png.
- La sesión de Playwright interceptó las API con datos sintéticos: no consultó ni modificó recetas reales.
- Capturas: cero errores de página y cero desbordamiento horizontal a 390px.
- Prueba de navegador con UI real: búsqueda por título, filtro de categoría, indicación «Aplicados», despliegue «Más opciones», «Revisar preparación», «Añadir a una comida del menú» y «Preparar esta receta». PASS.
- Rutas y procesos temporales de captura retirados. Cachés .next/dev creadas para la revisión eliminadas. Galería local de imágenes conservada.

## Verificaciones
- TypeScript y ESLint del alcance: PASS.
- Vitest de recetario: 37/37 PASS.
- Playwright conectado recipes-mobile-ux.spec.ts: añadido para CI (no se ejecutó contra PostgreSQL local).
- Aprobación visual del propietario: pendiente.
- Sin Docker builds, instalaciones, push, PR, merge ni despliegues en este bloque.
