# CocinaCore Bistró — UX Área 1 · Pantalla 3: Asistente de recetas

## Base y alcance
- Base exacta: rama feat/cc-ux-recipes-mobile-first del commit 07da4775c03ba0d9fd7b6e2b4e51f0d9404eb144 (PR #144, CI de GitHub aprobado, todavía abierta).
- Nueva rama local: feat/cc-ux-recipe-assistant-mobile-first, pendiente de aceptación visual.
- Se modifica únicamente frontend/src/app/recipes/search/page.tsx y se añade una prueba Playwright UX de esta misma pantalla. No cambia API, permisos, contratos, tablas, RAG, modelos ni inventario.
- El diseño hereda la navegación móvil aprobada de la PR #143 y el recetario de la #144, sin volver a modificarlos.

## Diagnóstico
- El formulario original presentaba primero un campo secundario, luego ingredientes, restricciones y un selector de modo técnico.
- Faltaba jerarquía y claridad para quien quiere simplemente obtener una idea de receta desde su teléfono.
- La primera propuesta de diseño colocaba el botón principal bajo la barra móvil; se corrigió antes de presentarla al propietario.

## Mejora propuesta
- Cabecera Bistró concisa, enlace directo al historial y redacción orientada a la tarea culinaria.
- Ingredientes primero (opcionales, uno por línea, ejemplo claro).
- Restricciones y fuente de ideas siempre disponibles, con etiquetas legibles: «Ideas de la IA» o «Libros de cocina (PDF)»; se conservan los valores de API free/rag.
- Acción «Generar receta» prominente y visible por encima de la barra de navegación inferior en móvil 390×844.
- Nombre personalizado opcional agrupado después de la acción principal. Para un nombre entregado desde el planificador, se muestra una indicación explícita y el control aparece abierto.
- Receta generada en un bloque legible y adaptable, conservando advertencia de revisión y flujo «Importar al recetario» con edición y confirmación antes de guardar.
- Estados de carga, error, importación, restricciones y falta de contexto PDF preservados.

## Comparación real
- Capturas React/Next desde el código anterior y el candidato, con el mismo formulario y una respuesta de generación ficticia e interceptada, en teléfono 390×844 y escritorio 1440×900.
- Comparador: http://127.0.0.1:4397/asistente.html disponible solo en la Mac mediante loopback; permite alternar dispositivo y estado inicial/generado.
- Pantalla móvil: botón termina a y≈736 px, barra inferior empieza y≈783 px, sin solapamiento.
- Captura real de navegador: sin overflow horizontal en 390 px, sin errores JS; se validó free, el payload de ingredientes/restricciones y el resultado simulado sin llamadas al modelo.
- Navegación interactiva: validación manual automatizada PASS para selector rag, control de nombre, restricciones, payload, revisión previa al guardado, botón deshabilitado durante revisión y prellenado desde planificador.
- Las rutas temporales de captura y los dos servidores Next dev fueron retirados. Solo se conservaron las imágenes y la galería local. Las cachés Next dev generadas para la revisión fueron limpiadas.

## Pruebas
- TypeScript y ESLint del alcance: PASS.
- Vitest focal de página: 7/7 PASS.
- Suite completa: 2.277 PASS / 123 SKIP, 179 archivos PASS, 0 fallos.
- E2E adicional: frontend/e2e/specs/recipe-assistant-mobile-ux.spec.ts (móvil CTA, PDF, revisión, handoff, escritorio), pendiente de ejecución en CI cuando se publique.
- No se realizaron cambios a la base de datos, compras reales, recetas privadas ni despliegues. Sin builds Docker ni instalaciones.

## Estado
- PENDIENTE DE APROBACIÓN VISUAL DEL PROPIETARIO para crear la PR. No publicar ni integrar mientras tanto.
