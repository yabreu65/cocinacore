ALTER TABLE public.user_recipes
  ADD COLUMN archived_at timestamptz;

CREATE INDEX idx_user_recipes_tenant_user_archived_at
  ON public.user_recipes (tenant_id, user_id, archived_at);
