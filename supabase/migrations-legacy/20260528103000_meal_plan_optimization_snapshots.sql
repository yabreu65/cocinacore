begin;

create table if not exists public.user_meal_plan_optimization_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  meal_plan_id uuid not null references public.user_meal_plans(id) on delete cascade,
  optimization_mode text not null check (
    optimization_mode in (
      'reduce_waste',
      'optimize_cost',
      'prioritize_fresh',
      'reduce_missing',
      'reuse_proteins',
      'balance_ingredients'
    )
  ),
  baseline_score jsonb not null,
  optimized_score jsonb not null,
  comparison jsonb not null,
  explainability_notes jsonb not null,
  baseline_calendar jsonb not null,
  optimized_calendar jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_user_meal_plan_optimization_snapshots_scope
  on public.user_meal_plan_optimization_snapshots (tenant_id, user_id, created_at desc);

alter table public.user_meal_plan_optimization_snapshots enable row level security;

drop policy if exists "Members can read own optimization snapshots" on public.user_meal_plan_optimization_snapshots;
create policy "Members can read own optimization snapshots"
  on public.user_meal_plan_optimization_snapshots
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own optimization snapshots" on public.user_meal_plan_optimization_snapshots;
create policy "Members can insert own optimization snapshots"
  on public.user_meal_plan_optimization_snapshots
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own optimization snapshots" on public.user_meal_plan_optimization_snapshots;
create policy "Members can delete own optimization snapshots"
  on public.user_meal_plan_optimization_snapshots
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
