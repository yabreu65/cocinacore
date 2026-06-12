begin;

alter table public.recipe_ai_history
  add column if not exists user_feedback text check (user_feedback in ('accepted', 'discarded'));

alter table public.recipe_ai_history
  add column if not exists user_feedback_at timestamptz;

create index if not exists idx_recipe_ai_history_feedback
  on public.recipe_ai_history (tenant_id, user_id, user_feedback, created_at desc);

commit;

