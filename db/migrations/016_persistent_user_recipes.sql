CREATE TABLE public.user_recipes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_recipes_pkey PRIMARY KEY (id),
  CONSTRAINT user_recipes_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT user_recipes_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_recipes_tenant_user_membership_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_recipes_id_tenant_id_user_id_key UNIQUE (id, tenant_id, user_id),
  CONSTRAINT user_recipes_tags_bounds_check CHECK (
    cardinality(tags) <= 20 AND array_position(tags, NULL) IS NULL
  )
);

CREATE INDEX idx_user_recipes_tenant_id ON public.user_recipes (tenant_id);
CREATE INDEX idx_user_recipes_user_id ON public.user_recipes (user_id);

CREATE TABLE public.user_recipe_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version_number integer NOT NULL,
  title text NOT NULL,
  instructions text NOT NULL,
  servings integer,
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_recipe_history_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_recipe_versions_pkey PRIMARY KEY (id),
  CONSTRAINT user_recipe_versions_version_number_check CHECK (version_number > 0),
  CONSTRAINT user_recipe_versions_title_nonempty_check CHECK (length(btrim(title)) > 0),
  CONSTRAINT user_recipe_versions_servings_check CHECK (servings IS NULL OR servings > 0),
  CONSTRAINT user_recipe_versions_ingredients_array_check CHECK (jsonb_typeof(ingredients) = 'array'),
  CONSTRAINT user_recipe_versions_recipe_id_version_number_key UNIQUE (recipe_id, version_number),
  CONSTRAINT user_recipe_versions_recipe_owner_fkey FOREIGN KEY (recipe_id, tenant_id, user_id)
    REFERENCES public.user_recipes(id, tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_recipe_versions_source_recipe_history_id_fkey FOREIGN KEY (source_recipe_history_id)
    REFERENCES public.recipe_ai_history(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_recipe_versions_recipe_id ON public.user_recipe_versions (recipe_id);
CREATE INDEX idx_user_recipe_versions_tenant_id ON public.user_recipe_versions (tenant_id);
CREATE INDEX idx_user_recipe_versions_user_id ON public.user_recipe_versions (user_id);

CREATE FUNCTION public.enforce_user_recipe_version_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'USER_RECIPE_VERSION_IMMUTABLE';
  END IF;

  IF NEW.source_recipe_history_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.user_recipes recipe
      JOIN public.recipe_ai_history history
        ON history.id = NEW.source_recipe_history_id
       AND history.tenant_id = recipe.tenant_id
       AND history.user_id = recipe.user_id
     WHERE recipe.id = NEW.recipe_id
  ) THEN
    RAISE EXCEPTION 'USER_RECIPE_HISTORY_OWNER_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_recipe_versions_invariants
BEFORE INSERT OR UPDATE ON public.user_recipe_versions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_recipe_version_invariants();

ALTER TABLE public.user_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY user_recipes_tenant_user_isolation
  ON public.user_recipes
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE public.user_recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recipe_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY user_recipe_versions_tenant_user_isolation
  ON public.user_recipe_versions
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
