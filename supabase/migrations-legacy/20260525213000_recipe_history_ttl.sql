begin;

alter table public.recipe_ai_history
  add column if not exists is_saved boolean not null default false;

alter table public.recipe_ai_history
  add column if not exists expires_at timestamptz;

update public.recipe_ai_history
set is_saved = true,
    expires_at = null
where expires_at is null;

alter table public.recipe_ai_history
  alter column expires_at set default (timezone('utc'::text, now()) + interval '12 hours');

create index if not exists idx_recipe_ai_history_expiry_cleanup
  on public.recipe_ai_history (tenant_id, user_id, is_saved, expires_at);

create or replace function public.cleanup_expired_recipe_ai_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.recipe_ai_history
  where is_saved = false
    and expires_at is not null
    and expires_at <= timezone('utc'::text, now());

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

commit;
