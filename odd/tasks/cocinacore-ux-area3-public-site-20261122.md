# CocinaCore Bistró · Área 3: Sitio público, cuatro pantallas

## Alcance
- Rama de revisión local: feat/cc-ux-public-site-four-mobile-first.
- Base local: candidato aprobado del Área 2, commit 5de2b2c57d1f6b9965052e216837f938aaed8d02 (PR #149).
- Propósito: mejorar entrada al sitio y navegación a textos legales. No modificar sustancia legal, autenticación, endpoints ni Docker.
- Pantallas: / (portada); /privacy; /terms; /cookies.

## Cambios
- Portada: inicio de sesión visible también en móvil; el enlace de marca regresa a la portada; botones principales táctiles, jerarquía mejorada; pie de página con los tres documentos legales.
- Privacidad, términos y cookies: nuevo envoltorio PublicLegalShell con identidad Bistró, navegación entre documentos, botón de regresar al sitio y señalización transparente de que los textos continúan en inglés pendientes de traducción/revisión legal separadas.
- Se conserva cada sección de las políticas originales, sin modificar su contenido textual. No se agregaron ni se quitaron obligaciones, declaraciones de seguridad o compromisos legales.
- Las ofertas y el contenido de portada originales tampoco cambiaron (incluida la promoción de período de prueba existente).

## Evidencia
- Comparador local: http://127.0.0.1:4397/area3-20261122/revision-sitio.html
- 8 capturas originales + 8 capturas rediseñadas; 4 rutas, móvil 390x844 y escritorio 1440x900; todas HTTP 200, 0 errores JS, 0 desbordamientos y 0 escrituras.
- Vista completa y primera pantalla en móvil, vista completa en escritorio.
- Comparador con navegación y verificación de imágenes aprobado en móvil y escritorio.
- Pruebas E2E locales: 4/4 aprobadas (flujos de enlaces, navegación legal, viewport 320/390/1440).
- Tipo y lint: TypeScript + ESLint aprobados.
- Vitest completo: 179 archivos aprobados, 19 omitidos; 2277 pruebas aprobadas, 123 omitidas; 0 fallos.
- Prueba estructural: el texto de las 5 secciones de privacidad, 5 secciones de términos y 4 secciones de cookies coincide con el texto de origin/main (solo cambiaron estilos y envoltorio).
- Ninguna credencial, cookie, token, mutación de API ni base de datos real utilizada para las vistas.

## Integración
- El Área 3 requiere revisión visual del propietario. No publicar PR, no hacer merge ni despliegue antes de aprobación expresa.
- El Área 2, PR #149, mantiene su propia validación CI y debe integrarse primero.
- La app original en Docker permanece intacta.
- Los textos legales requieren revisión legal/editorial y traducción explícita por separado si se desea publicar documentación definitiva en español.
