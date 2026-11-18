# F56 — Panel administrativo: presentación y navegación

Base: `347da862e59185a50ed36347dd82d99523ae9747`.

Objetivo: ofrecer un resumen administrativo comprensible en español, con identidad Bistró, navegación accesible y acciones existentes visibles. Distinguir pantallas disponibles de secciones todavía no implementadas.

Alcance: exclusivamente presentación de OwnerShell, página de resumen, aviso de pantallas provisionales y pruebas de renderizado de estos componentes. Conservar métricas, rutas y controles de acceso existentes.

Aceptación:
- Resumen presenta métricas existentes y enlaces a biblioteca, documentos, carga PDF y estado del sistema.
- Navegación escritorio y móvil en español con ruta activa identificada y retorno al hogar.
- Hogares, indexación y moderación identificados explícitamente como pendientes, sin prometer funcionalidades que no existen.
- Pruebas de presentación y regresión, TypeScript, ESLint y gate nativo satisfactorios.

Exclusiones: autenticación, sesiones, permisos, consultas, APIs, usuarios, datos, almacenamiento, migraciones, despliegues y ejecución de flujos administrativos reales. B6 y cualquier nueva capacidad son independientes.

## Evidencia local
- 6/6 Vitest del panel (tres regresiones de presentación y tres controles existentes), PASS.
- ESLint de los cuatro archivos TypeScript, PASS.
- TypeScript `tsc --noEmit`, PASS.
- Next.js 16.4.5 production build, PASS; aviso preexistente de deprecación de Sentry.
- La revisión de diff confirma que las métricas, controles existentes, rutas y operaciones de servidor no fueron alterados. Las tres pantallas pendientes no se anuncian como funcionales.
- Sin cambio de la imagen F56, sin despliegue ni operación administrativa real. Aceptación visual en ejecución y CI de publicación pendientes.
