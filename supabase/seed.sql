-- Seed data for E2E testing - Compatible with current schema
-- Tables: tenants, users, global_books, tenant_books, book_chunks, recipe_generations

-- Test tenant
INSERT INTO public.tenants (id, name, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Tenant',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Note: public.users references auth.users(id), so the auth user must exist first.
-- Use Supabase Auth Admin API or sign up via the app to create auth.users,
-- then run:
-- INSERT INTO public.users (id, tenant_id, email, role, created_at)
-- VALUES ('AUTH_USER_UUID_HERE', '00000000-0000-0000-0000-000000000001', 'test@cocinacore.local', 'admin', NOW());

-- Sample global book
INSERT INTO public.global_books (id, title, author, description, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Recetario Familiar de Prueba',
  'CocinaCore',
  'Libro de prueba para desarrollo',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Sample tenant book
INSERT INTO public.tenant_books (id, tenant_id, title, author, description, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Cocina Casera',
  'Abuela',
  'Recetas tradicionales de la familia',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Sample book chunk with dummy embedding (1536 dimensions of 0.1)
INSERT INTO public.book_chunks (id, tenant_id, global_book_id, tenant_book_id, content, embedding, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  NULL,
  '00000000-0000-0000-0000-000000000002',
  NULL,
  'Receta de pollo al horno: precalentar horno a 180 grados, hornear por 45 minutos.',
  (SELECT array_agg(0.1)::vector(1536) FROM generate_series(1, 1536)),
  NOW()
)
ON CONFLICT (id) DO NOTHING;
