# CocinaCore Bistró · Área 2: Acceso y seguridad · seis pantallas

## Alcance y base
- Base de revisión: origin/main commit f7e5803f42d273db8d1e5a01801adbdef4ea08c7, después de integrar el Área 1 (20 rutas).
- Rama local: feat/cc-ux-access-security-six-mobile-first.
- Solo diseño: mantener intactos flujos de autenticación, permisos, contraseñas, tokens, rutas API y middleware.
- No se modifican endpoints, esquemas, almacenamiento, sesiones ni Docker.

## Pantallas cubiertas
1. /login: formulario visible sin animación de opacidad, enlace a registro y recuperación, conmutador para mostrar contraseña. Google/GitHub indicados como en preparación.
2. /signup: nombre, email, contraseña, confirmación, aceptación de términos y botón de registro, con OAuth en preparación.
3. /forgot-password: solicitud por correo, mensajes accesibles y aviso de privacidad sobre la existencia de cuentas.
4. /reset-password: token solo condiciona habilitación del formulario; autocomplete=new-password y sin operación automática.
5. /mfa: función temporalmente no disponible, sin código ficticio.
6. /invite/[token]: Bistró para hogares no admite cuentas adicionales por invitación. No muestra el bearer token; los comensales se agregan al perfil culinario, sin cuentas adicionales.

## Diseño y seguridad
- Verde Bistró, champagne, tipografía de títulos y botones de acción principal consistentes.
- Panel informativo compartido con características reales en login y registro; se quitan tarjetas con supuestos datos de recetas, PDF e inventario.
- Formulario prioritario en móvil; panel adicional solo en escritorio.
- Roles accesibles alert/status donde corresponden. Nombres originales de campos conservados.
- Se eliminó la animación de entrada del formulario para evitar pantallas vacías al cargar.
- El flujo de autenticación y las operaciones mutables no cambian.

## Evidencia local
- Comparador de seis rutas Antes/Después (390×844 y 1440×900):
  http://127.0.0.1:4397/acceso-20261122/revision-acceso.html
- Imágenes anteriores obtenidas de la aplicación original mediante navegación de solo lectura sin credenciales.
- Imágenes posteriores en vista aislada de código real Next.js; sin registro, login, contraseña ni cuentas reales.
- 12/12 capturas anteriores y 12/12 posteriores: HTTP 200, cero errores JS, cero desbordamiento horizontal.
- Comparador interactivo probado en móvil y escritorio, seis rutas y ambas vistas, PASS.
- TypeScript y ESLint: PASS.
- Vitest completo: 179 archivos PASS, 2.277 pruebas PASS, 19 archivos/123 pruebas omitidas, 0 fallos.
- Nueva especificación Playwright frontend/e2e/specs/auth-access-mobile-ux.spec.ts: 5/5 PASS en servidor aislado; sin escrituras reales.
- Contratos de privacidad de invitaciones y sesiones login existentes: PASS.

## Integración
- Aceptación visual del propietario: PENDIENTE.
- NO publicar PR, hacer merge, desplegar ni construir imágenes Docker sin esa aprobación.
- Tras aprobación: publicar PR, revisar CI completo y luego integrar por el proceso autorizado.
