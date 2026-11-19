# F56 B.RAG — Acceso directo al historial

Base: e6a737984e569426414090be8464c3df319445b2. Refs #124.

Alcance aprobado: añadir acceso visible a /recipes/history desde Mi recetario y Buscar recetas; conservar Crear receta y Volver. Usar estilos Bistró existentes, con acciones que envuelven en pantallas pequeñas.

Aceptación: ambos enlaces visibles y navegables, sin generar recetas ni llamar al proveedor. No cambiar historial, persistencia, API, autenticación, permisos, migraciones ni CI. Pruebas de regresión en los dos archivos de pruebas existentes.

La generación real RAG y el guardado en Mi recetario ya se verificaron. La visualización de citas en el detalle del historial sigue pendiente de comprobación real.

Validación local: Node 22.22.3, 36/36 pruebas focalizadas (3 suites), ESLint focalizado, TypeScript, build Next.js 16.4.5 (66/66 páginas estáticas) y diff --check PASS. Las pruebas comprueban ambos enlaces y que su renderizado no llama a la API. CI integral y aceptación visual del runtime nuevo aún pendientes.
