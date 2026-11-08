-- Candidate component for a future 020. Apply only in a disposable database.
-- RLS authenticates neither session GUC: trusted backend must set both.
-- The policy's user/membership lookups rely on their current grants and require
-- compatible SELECT policies when users and memberships receive FORCE RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocinacore_runtime_rls' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN
    RAISE EXCEPTION 'Expected restricted runtime role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member OR r.oid = m.roleid WHERE r.rolname = 'cocinacore_runtime_rls') THEN
    RAISE EXCEPTION 'Runtime role must not have memberships';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.recipe_inventory_items'::regclass, 'public.inventory_movements'::regclass)) THEN
    RAISE EXCEPTION 'Existing policies require explicit composition review';
  END IF;
  IF has_table_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'UPDATE')
    OR has_column_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'tenant_id', 'UPDATE')
    OR has_column_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'user_id', 'UPDATE')
    OR has_table_privilege('cocinacore_runtime_rls', 'public.inventory_movements', 'UPDATE')
    OR has_table_privilege('cocinacore_runtime_rls', 'public.inventory_movements', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected runtime inventory grants';
  END IF;
END $$;

ALTER TABLE public.recipe_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_runtime_select ON public.recipe_inventory_items FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_insert ON public.recipe_inventory_items FOR INSERT TO cocinacore_runtime_rls
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=recipe_inventory_items.user_id AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_update ON public.recipe_inventory_items FOR UPDATE TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id))
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_delete ON public.recipe_inventory_items FOR DELETE TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY movement_runtime_select ON public.inventory_movements FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=inventory_movements.tenant_id));
CREATE POLICY movement_runtime_insert ON public.inventory_movements FOR INSERT TO cocinacore_runtime_rls
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=inventory_movements.user_id AND u.tenant_id=inventory_movements.tenant_id) AND EXISTS (
   SELECT 1 FROM public.recipe_inventory_items i WHERE i.id=inventory_movements.inventory_item_id AND i.tenant_id=inventory_movements.tenant_id));
