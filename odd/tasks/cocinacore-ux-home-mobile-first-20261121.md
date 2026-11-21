# CocinaCore Bistró — Auditoría UX Área 1 · Página 1 (Inicio y navegación móvil)

## Punto de partida
- Base: main `450d3c25e1451f7f6d4fedad5a3369bf67a2ce47`.
- Rama aislada: `feat/cc-ux-home-mobile-first`.
- Objetivo: mobile-first (390 px) para Inicio y navegación común del hogar; sin alterar flujos de negocio, APIs ni datos.
- Capturas realizadas desde la UI React/Next real del árbol original y el candidato, con respuestas de red idénticas y sintéticas, interceptadas por Playwright. No representan los datos personales.
- Comparador local y capturas: `~/.local/share/cocinacore/ux-review/home-20261121/comparacion.html`; servidor únicamente en `127.0.0.1:4397`. La ruta `/ux-review` fue temporal y ya no forma parte del código candidato.

## Problemas encontrados
- Inicio mostraba primero cuatro tarjetas grandes, luego las compras/menú; existía redundancia de accesos.
- Menú móvil dependía de abrir el panel lateral para cualquier navegación frecuente.
- Primer bloque de actividad diaria estaba visualmente relegado en la pantalla pequeña.

## Candidato
- Inicio con bienvenida Bistró, jerarquía de acciones y CTA para descubrir una receta.
- Compras/menú suben en la jerarquía, conservando estados reales, errores y límites de API.
- Accesos secundarios compactos para Inventario y Recetas, sin duplicar enlaces de Compras/Planificador presentes arriba y en la navegación.
- Navegación inferior móvil con Inicio, Recetas, Planificar, Compras y Más; acceso completo en Más con enfoque y diálogo existente. Sidebar de escritorio permanece igual.
- Se preservan accesibilidad y enlaces, sin cambios de escritura ni en modelos, endpoints o permisos.

## Comprobaciones
- Capturas móviles 390×844 y escritorio 1440×900 del Antes y Después: listas, mismo contenido de demostración.
- Playwright de captura: cero errores de página y cero desbordamiento horizontal en ambos tamaños móviles.
- TypeScript `--noEmit`: PASS; ESLint del alcance: PASS.
- Vitest focal 15/15 PASS, 4 archivos.
- Vitest completo: 2.277 PASS, 123 omitidas, 179 archivos PASS, cero fallos.
- Nueva especificación Playwright conectada: prueba de barra móvil, menú accesible, ausencia de overflow y sidebar desktop, pendiente de CI si se publica la PR.
- No se han realizado merge ni despliegue; `127.0.0.1:3000` sigue con la versión estable. Los datos reales no fueron accedidos ni modificados para las capturas.

## Aceptación
- Estado: **PENDIENTE DE EVALUACIÓN VISUAL DEL PROPIETARIO**.
- Solicitar su criterio sobre la comparación de Inicio en teléfono antes de publicar la PR.
- Conservar el candidato intacto en su rama para modificaciones por feedback. No desplegar ni mergear sin aprobación.
