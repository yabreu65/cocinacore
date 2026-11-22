# CocinaCore Bistró — Área 4: Administración de plataforma

## Candidato V2 — rediseño estructural
Rama: feat/cc-ux-area4-owner-20261122, origin/main en fb8cc35 al inicio.
Motivo: la primera revisión visual del Área 4 no presentó mejoras sustantivas; no fue aprobada.

### Ocho pantallas incluidas
- /owner — navegación simplificada; cuatro KPIs principales en grid 2×2 móvil y tres adicionales compactos; acciones rápidas; pendientes separados.
- /owner/global-books — biblioteca real en listados compactos con origen, autor, estilo y etiquetas.
- /owner/global-pdfs — documentos en lista compacta; ruta técnica plegable; enlace real a cargar PDF.
- /owner/global-pdfs/upload — tres bloques: datos del libro, clasificación culinaria y documento; se conserva el flujo completo de carga/indexación.
- /owner/indexing — informativa; sin promesas de funciones operativas.
- /owner/premium-moderation — informativa; sin promesas de funciones operativas.
- /owner/tenants — informativa en español (Hogares); sin promesas de funciones operativas.
- /owner/system-health — estructura para supervisión y dependencias; carga inicial explícita (no se inventa el estado) y se mantienen los valores reales al obtenerlos.

### Diseño transversal
- Móvil: navegación por menú desplegable con ocho enlaces, sin scroll horizontal; áreas táctiles accesibles y KPIs de dos columnas.
- Escritorio: barra lateral estable; contenido principal con jerarquía diferenciada, listados en columnas y formulario en paneles.
- Etiquetas y explicaciones en español.
- No se agregaron endpoints, acciones administrativas, permisos, consultas SQL, tablas, cuentas ni datos.
- Las rutas propietarias continúan protegidas por las validaciones originales de sesión y rol.

### Revisión visual
Comparador local: http://127.0.0.1:4397/area4-v2-20261122/revision-area4-v2.html
- Antes: capturas del main previo tomadas con las mismas fixtures ficticias.
- Después: componentes de la nueva rama renderizados con mocks de lectura y sin acciones.
- Ocho pantallas × dos dispositivos × Antes/Después = 32 imágenes.
- Las capturas de Estado del sistema muestran la fase inicial de comprobación, no un estado operativo simulado.
- Todas las capturas Después: HTTP 200, sin errores JS, sin escrituras, sin overflow a 390 y 1440px.

### Validación final
- TypeScript: aprobado.
- ESLint del área: aprobado.
- Vitest completo: 179 archivos aprobados, 19 omitidos; 2277 pruebas aprobadas, 123 omitidas, cero fallos.
- Capturas Después: 16/16 correctas, HTTP 200; cero errores JS, escrituras y desbordamientos.
- Comparador: imágenes de las ocho pantallas cargan en móvil (390px) y escritorio (1440px).
- Navegación móvil: menú desplegable con ocho enlaces visibles y exactamente uno activo.
- Datos de las capturas: ficticios y de solo lectura; el estado del sistema se muestra en su fase inicial de comprobación.

### Pendiente
- Aprobación visual expresa del propietario.
- No publicar PR ni integrar en main ni modificar Docker antes de aprobación.
