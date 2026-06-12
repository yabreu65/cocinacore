begin;

create table if not exists public.culinary_dimensions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.culinary_terms (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references public.culinary_dimensions(id) on delete cascade,
  key text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (dimension_id, key)
);

create table if not exists public.user_culinary_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  level text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.user_culinary_profile_terms (
  user_id uuid not null references public.user_culinary_profiles(user_id) on delete cascade,
  term_id uuid not null references public.culinary_terms(id) on delete cascade,
  preference_type text not null check (preference_type in ('identity', 'prefer', 'avoid', 'goal')),
  weight smallint not null default 1 check (weight between 1 and 5),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, term_id, preference_type)
);

create index if not exists idx_culinary_terms_dimension on public.culinary_terms(dimension_id);
create index if not exists idx_profile_terms_user on public.user_culinary_profile_terms(user_id);
create index if not exists idx_profile_terms_term on public.user_culinary_profile_terms(term_id);

alter table public.culinary_dimensions enable row level security;
alter table public.culinary_terms enable row level security;
alter table public.user_culinary_profiles enable row level security;
alter table public.user_culinary_profile_terms enable row level security;

drop policy if exists "Authenticated users can read culinary dimensions" on public.culinary_dimensions;
create policy "Authenticated users can read culinary dimensions"
  on public.culinary_dimensions
  for select
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can read culinary terms" on public.culinary_terms;
create policy "Authenticated users can read culinary terms"
  on public.culinary_terms
  for select
  using (auth.uid() is not null);

drop policy if exists "Users can read own culinary profile in tenant" on public.user_culinary_profiles;
create policy "Users can read own culinary profile in tenant"
  on public.user_culinary_profiles
  for select
  using (user_id = auth.uid() and tenant_id = public.get_auth_tenant_id());

drop policy if exists "Users can upsert own culinary profile in tenant" on public.user_culinary_profiles;
create policy "Users can upsert own culinary profile in tenant"
  on public.user_culinary_profiles
  for all
  using (user_id = auth.uid() and tenant_id = public.get_auth_tenant_id())
  with check (user_id = auth.uid() and tenant_id = public.get_auth_tenant_id());

drop policy if exists "Users can read own culinary profile terms" on public.user_culinary_profile_terms;
create policy "Users can read own culinary profile terms"
  on public.user_culinary_profile_terms
  for select
  using (
    exists (
      select 1
      from public.user_culinary_profiles ucp
      where ucp.user_id = user_culinary_profile_terms.user_id
        and ucp.user_id = auth.uid()
        and ucp.tenant_id = public.get_auth_tenant_id()
    )
  );

drop policy if exists "Users can manage own culinary profile terms" on public.user_culinary_profile_terms;
create policy "Users can manage own culinary profile terms"
  on public.user_culinary_profile_terms
  for all
  using (
    exists (
      select 1
      from public.user_culinary_profiles ucp
      where ucp.user_id = user_culinary_profile_terms.user_id
        and ucp.user_id = auth.uid()
        and ucp.tenant_id = public.get_auth_tenant_id()
    )
  )
  with check (
    exists (
      select 1
      from public.user_culinary_profiles ucp
      where ucp.user_id = user_culinary_profile_terms.user_id
        and ucp.user_id = auth.uid()
        and ucp.tenant_id = public.get_auth_tenant_id()
    )
  );

insert into public.culinary_dimensions (key, label, sort_order)
values
  ('regional_cuisine', 'Cocina regional/cultural', 10),
  ('culinary_style', 'Estilo culinario', 20),
  ('food_goal', 'Objetivo alimentario', 30),
  ('technique', 'Técnica culinaria', 40),
  ('skill_level', 'Nivel culinario', 50)
on conflict (key) do update
set label = excluded.label,
    sort_order = excluded.sort_order;

with dim as (
  select id, key from public.culinary_dimensions
)
insert into public.culinary_terms (dimension_id, key, label)
select d.id, t.key, t.label
from dim d
join (
  values
    ('regional_cuisine','italiana','Italiana'),
    ('regional_cuisine','latina','Latina'),
    ('regional_cuisine','asiatica','Asiática'),
    ('regional_cuisine','mediterranea','Mediterránea'),
    ('regional_cuisine','mexicana','Mexicana'),
    ('regional_cuisine','arabe','Árabe'),
    ('culinary_style','casera','Casera'),
    ('culinary_style','gourmet','Gourmet'),
    ('culinary_style','saludable','Saludable'),
    ('culinary_style','parrilla','Parrilla'),
    ('culinary_style','vegana','Vegana'),
    ('culinary_style','comfort_food','Comfort food'),
    ('culinary_style','rapida','Rápida'),
    ('culinary_style','postres','Postres'),
    ('food_goal','familiar','Familiar'),
    ('food_goal','fitness','Fitness'),
    ('food_goal','sin_gluten','Sin gluten'),
    ('food_goal','sin_lactosa','Sin lactosa'),
    ('food_goal','keto','Keto'),
    ('food_goal','meal_prep','Meal prep'),
    ('food_goal','infantil','Infantil'),
    ('food_goal','frutos_secos','Frutos secos'),
    ('food_goal','mariscos','Mariscos'),
    ('technique','horneado','Horneado'),
    ('technique','parrilla_tecnica','Parrilla'),
    ('technique','salteado','Salteado'),
    ('technique','freido','Freído'),
    ('technique','reposteria','Repostería'),
    ('skill_level','principiante','Principiante'),
    ('skill_level','intermedio','Intermedio'),
    ('skill_level','chef','Chef')
) as t(dimension_key, key, label)
  on t.dimension_key = d.key
on conflict (dimension_id, key) do update
set label = excluded.label,
    is_active = true;

commit;
