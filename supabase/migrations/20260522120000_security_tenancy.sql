-- Migration: Security tenancy hardening (tenant type, role normalization, strict tenant RLS)

begin;

-- 1) Tenant type classification
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_type') THEN
    CREATE TYPE public.tenant_type AS ENUM ('home', 'professional');
  END IF;
END
$$;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tenant_type public.tenant_type;

UPDATE public.tenants
SET tenant_type = 'home'::public.tenant_type
WHERE tenant_type IS NULL;

ALTER TABLE public.tenants
  ALTER COLUMN tenant_type SET DEFAULT 'home'::public.tenant_type,
  ALTER COLUMN tenant_type SET NOT NULL;

-- 2) Normalize tenant member roles
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE public.users
SET role = CASE role
  WHEN 'superadmin' THEN 'owner'
  WHEN 'admin' THEN 'admin'
  WHEN 'user' THEN 'member'
  ELSE role
END;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- 3) Platform owner separation (SaaS/global control)
CREATE TABLE IF NOT EXISTS public.platform_owners (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_owners (user_id)
SELECT id
FROM public.users
WHERE role = 'owner'
  AND EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = public.users.id
      AND COALESCE(au.raw_user_meta_data ->> 'role', '') = 'superadmin'
  )
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role IN ('owner', 'admin'), false)
  FROM public.users
  WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_owners po
    WHERE po.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_tenant_admin() OR public.is_platform_owner();
$$;

-- 4) Tighten tenant-owned RLS to explicit deny-by-default + tenant scope checks
DROP POLICY IF EXISTS "Anyone authenticated can read global books" ON public.global_books;
DROP POLICY IF EXISTS "Only superadmins can manage global books" ON public.global_books;

CREATE POLICY "Authenticated users can read global books"
  ON public.global_books
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Platform owners can manage global books"
  ON public.global_books
  FOR ALL
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

DROP POLICY IF EXISTS "Users can view their own tenant" ON public.tenants;
DROP POLICY IF EXISTS "Admins can update their tenant details" ON public.tenants;

CREATE POLICY "Tenant members can view their own tenant"
  ON public.tenants
  FOR SELECT
  USING (id = public.get_auth_tenant_id());

CREATE POLICY "Tenant admins can update their own tenant"
  ON public.tenants
  FOR UPDATE
  USING (id = public.get_auth_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (id = public.get_auth_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "Users can view members of their same tenant" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can manage tenant users" ON public.users;

CREATE POLICY "Tenant members can view tenant users"
  ON public.users
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can update own profile in tenant"
  ON public.users
  FOR UPDATE
  USING (id = auth.uid() AND tenant_id = public.get_auth_tenant_id())
  WITH CHECK (id = auth.uid() AND tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant admins can insert tenant users"
  ON public.users
  FOR INSERT
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.is_tenant_admin());

CREATE POLICY "Tenant admins can update tenant users"
  ON public.users
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.is_tenant_admin());

CREATE POLICY "Tenant admins can delete tenant users"
  ON public.users
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "Users can view their tenant's books" ON public.tenant_books;
DROP POLICY IF EXISTS "Users can manage books within their tenant" ON public.tenant_books;

CREATE POLICY "Tenant members can view tenant books"
  ON public.tenant_books
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can insert tenant books scoped"
  ON public.tenant_books
  FOR INSERT
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can update tenant books scoped"
  ON public.tenant_books
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can delete tenant books scoped"
  ON public.tenant_books
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS "Users can read global chunks or their own tenant's chunks" ON public.book_chunks;
DROP POLICY IF EXISTS "Users can manage chunks within their tenant" ON public.book_chunks;

CREATE POLICY "Tenant members can read own-tenant chunks"
  ON public.book_chunks
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Authenticated users can read global chunks"
  ON public.book_chunks
  FOR SELECT
  USING (tenant_id IS NULL AND global_book_id IS NOT NULL AND auth.uid() IS NOT NULL);

CREATE POLICY "Tenant members can insert own-tenant chunks"
  ON public.book_chunks
  FOR INSERT
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can update own-tenant chunks"
  ON public.book_chunks
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can delete own-tenant chunks"
  ON public.book_chunks
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Platform owners can manage global chunks"
  ON public.book_chunks
  FOR ALL
  USING (tenant_id IS NULL AND global_book_id IS NOT NULL AND public.is_platform_owner())
  WITH CHECK (tenant_id IS NULL AND global_book_id IS NOT NULL AND public.is_platform_owner());

DROP POLICY IF EXISTS "Users can read generations from their tenant" ON public.recipe_generations;
DROP POLICY IF EXISTS "Users can manage their own generations" ON public.recipe_generations;

CREATE POLICY "Tenant members can read own-tenant generations"
  ON public.recipe_generations
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Tenant members can insert own-tenant generations"
  ON public.recipe_generations
  FOR INSERT
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid());

CREATE POLICY "Tenant members can update own generations"
  ON public.recipe_generations
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid());

CREATE POLICY "Tenant members can delete own generations"
  ON public.recipe_generations
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid());

-- 5) Keep signup trigger aligned with normalized roles + tenant type
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_tenant_name text;
  v_role text;
  v_tenant_type public.tenant_type;
BEGIN
  v_tenant_id := ((new.raw_user_meta_data ->> 'tenant_id')::uuid);
  v_tenant_name := COALESCE(new.raw_user_meta_data ->> 'tenant_name', 'Default Tenant');
  v_role := COALESCE(new.raw_user_meta_data ->> 'role', 'member');
  v_tenant_type := COALESCE((new.raw_user_meta_data ->> 'tenant_type')::public.tenant_type, 'home'::public.tenant_type);

  IF v_role = 'user' THEN
    v_role := 'member';
  ELSIF v_role = 'superadmin' THEN
    v_role := 'owner';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', v_role;
  END IF;

  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (name, tenant_type)
    VALUES (v_tenant_name, v_tenant_type)
    RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.users (id, tenant_id, email, role)
  VALUES (new.id, v_tenant_id, new.email, v_role);

  IF COALESCE(new.raw_user_meta_data ->> 'role', '') = 'superadmin' THEN
    INSERT INTO public.platform_owners (user_id)
    VALUES (new.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

commit;
