# PR C — supermercado con una confirmación (2026-11-20)

Base: `origin/main` 9f0216295d1e7973e804ed6e86ff9f5ddb470190. Rama: `feat/cc-prc-shopping-one-confirmation`.

## Revisión de alcance
- Se reutiliza GET/POST /api/meal-plan/shopping-suggestions y la transacción PostgreSQL protegida con lock, RLS tenant/user, timestamp y fingerprint; no se agregan endpoints ni migraciones.
- Se conservan preselección automática de cantidades conocidas, descuento de inventario existente, deduplicación y confirmación explícita.
- UI compacta: conteos, detalles plegables, selección opcional, pendientes no seleccionados y enlace a lista interna; sin mostrar costos sin moneda verificable.
- Límite de selección por confirmación: 250 en vez de 100. No se hacen lotes, reintentos ni compras externas. Para más de 250, botón bloqueado con aviso.
- No se modifican datos reales, inventario, receta, Gemini, Docker, VPS, credenciales ni esquema SQL.

## Validaciones locales
- TypeScript (`tsc --noEmit`): OK.
- ESLint completo: OK.
- Vitest completo: 2238 aprobadas, 123 omitidas, 0 fallos.
- Endpoint unitario 34/34, incluye 0/99/100/101/126 reales/250/251, guardas concurrentes y tenant ya existentes.
- Playwright stub agregado para resumen, excepción desmarcable y POST único. Ejecución E2E/build reservada al CI para evitar builds locales con 6.2 GiB libres.
- `git diff --check`: OK.

## Pendientes de entrega
- Hook nativo de precommit, commit/árbol y CI de PR.
- No merge ni despliegue sin autorización del propietario.
- Aceptación funcional con Gemini real de PR #139 y aceptación manual de PR C por separado.
