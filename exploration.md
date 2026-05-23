## Exploration: estado actual cocinacore (backend + PostgreSQL/Supabase local)

### Current State
El backend actual está implementado principalmente como **lógica de dominio TypeScript en el frontend de Next.js** y como **backend de datos/políticas en Supabase Postgres**.

Evidencia de backend implementado hoy (viernes 2026-05-22):
- Migraciones creadas hoy en `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations`:
  - `20260522120000_security_tenancy.sql` (May 22 00:35)
  - `20260522143000_auth_rbac_trial.sql` (May 22 09:36)
  - `20260522170000_rag_pdf_library.sql` (May 22 11:08)
  - `20260522183000_recipe_ai.sql` (May 22 13:21)
  - `20260522193000_premium_board.sql` (May 22 13:43)
- No se detectaron route handlers/API routes en `frontend/src/app/api`; la integración es cliente Supabase + servicios:
  - `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/lib/supabaseClient.ts`
  - `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/authService.ts`
  - `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/supabaseAdapter.ts`
  - `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/ragEngine.ts`
  - `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/premiumBoardService.ts`

Estado de base local (inspección real por `psql` en `postgresql://postgres:postgres@127.0.0.1:54322/postgres`):
- Tablas `public` detectadas: `tenants`, `users`, `platform_owners`, `global_books`, `tenant_books`, `book_chunks`, `recipe_generations`, `tenant_invitations`, `tenant_pdf_library`, `global_pdf_library`, `recipe_inventory_items`, `recipe_ai_history`, `recipe_ai_ratings`, `premium_recipes`, `premium_recipe_reviews`, `premium_review_reports`.
- Relaciones (FK) activas: 29 (ej. `users.tenant_id -> tenants.id`, `book_chunks.tenant_book_id -> tenant_books.id`, `premium_recipes.source_recipe_history_id -> recipe_ai_history.id`).
- RLS activo con 59 políticas en tablas multi-tenant.
- Triggers activos:
  - `auth.users.on_auth_user_created -> public.handle_new_user()`
  - `public.tenant_pdf_library.trg_enforce_tenant_pdf_limit -> public.enforce_tenant_pdf_limit()`
- Funciones de negocio críticas activas: `get_auth_tenant_id`, `is_tenant_admin`, `is_platform_owner`, `is_admin`, `can_manage_tenant_members`, `is_trial_active`, `accept_tenant_invitation`, `match_chunks`, `enforce_tenant_pdf_limit`, `handle_new_user`.

Datos existentes hoy (no seed masivo):
- `public.tenants`: 2 filas
- `public.users`: 2 filas
- Todas las demás tablas de dominio en 0 filas (`book_chunks`, `tenant_books`, `recipe_ai_history`, `premium_*`, etc.)
- Ejemplos concretos existentes:
  - Tenants: dos `Default Tenant` con `tenant_type=home` y trial activo hasta `2026-06-05`.
  - Users: 2 miembros (`role=member`) con `allergies={}` y `dietary_rules={}`.

### Affected Areas
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260521144343_init_schema.sql` — base del esquema, RLS inicial, `handle_new_user`, `match_chunks` inicial.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260522120000_security_tenancy.sql` — endurecimiento tenancy/RLS, separación `platform_owners`.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260522143000_auth_rbac_trial.sql` — invitaciones, trial soft-block, `accept_tenant_invitation`.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260522170000_rag_pdf_library.sql` — `pdf_source_type`, bibliotecas PDF, trigger límite, `match_chunks` reforzada.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260522183000_recipe_ai.sql` — inventario, historial y ratings de recetas con RLS por tenant+usuario.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/migrations/20260522193000_premium_board.sql` — premium board (publicación, reviews, reportes) + RLS.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/tests/rls_tenant_isolation.sql` — pruebas allow/deny de aislamiento multi-tenant + límites de PDFs + match_chunks.
- `/Users/yoryiabreu/proyectos/cocinacore/supabase/tests/premium_board_rls.sql` — pruebas de seguridad/comportamiento premium board.
- `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/authService.ts` — capa backend de auth/RBAC/invitaciones/trial desde cliente Supabase.
- `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/supabaseAdapter.ts` — acceso a `match_chunks`, `book_chunks`, `tenant_pdf_library` con filtro tenant.
- `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/ragEngine.ts` — orquesta ingestión PDF + embeddings + generación receta con controles trial/límites.
- `/Users/yoryiabreu/proyectos/cocinacore/frontend/src/services/premiumBoardService.ts` — capa de publicación/reviews/reportes premium.

### Approaches
1. **Seguir con backend en Supabase + servicios TS (estado actual)** — Mantener patrón actual (RLS fuerte en DB + lógica de dominio en servicios).
   - Pros: ya existe base sólida de seguridad multi-tenant, menor fricción para seguir frontend, evita duplicar backend.
   - Cons: parte del dominio todavía vive en capa frontend/cliente; requiere cuidado extremo con fronteras server-only (Gemini, secretos).
   - Effort: Low.

2. **Agregar API server explícita (Next route handlers/Edge) para casos críticos** — Encapsular operaciones sensibles en endpoints server-side.
   - Pros: mejor boundary de seguridad/observabilidad, menor riesgo de uso indebido desde cliente.
   - Cons: más complejidad inmediata y trabajo adicional antes de avanzar UI.
   - Effort: Medium.

### Recommendation
Recomiendo **continuar con el enfoque actual (Approach 1) para destrabar frontend**, pero con una regla clara: toda operación sensible (llaves, generación IA, acciones privilegiadas) debe ejecutarse server-side y no en cliente. La base de datos ya está bien encaminada (RLS + constraints + funciones + tests), y hoy el gap principal está más en integración UI y flujos que en esquema.

### Risks
- Riesgo de seguridad si se usa la capa de servicios directamente desde cliente para flujos que deberían ser server-only.
- Riesgo funcional: la DB está estructurada pero casi vacía (excepto tenants/users); faltan datos de ejercicio reales para validar UX end-to-end.
- Riesgo de drift entre lógica TS y reglas SQL si no se mantienen tests de contratos/RLS al evolucionar frontend.

### Ready for Proposal
Yes — Podemos pasar a proposal enfocado en “frontend integration over existing backend contracts”, usando como contrato fuente las tablas/RLS/funciones ya activas en Supabase local.
