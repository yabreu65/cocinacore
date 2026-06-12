-- Migration: Premium recipe board (publication, reviews, reports, statuses, RLS)

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'premium_recipe_status') THEN
    CREATE TYPE public.premium_recipe_status AS ENUM ('published', 'withdrawn', 'moderation_hidden');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'premium_report_status') THEN
    CREATE TYPE public.premium_report_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
  END IF;
END
$$;

create table if not exists public.premium_recipes (
  id uuid primary key default gen_random_uuid(),
  source_recipe_history_id uuid not null references public.recipe_ai_history(id) on delete cascade,
  source_tenant_id uuid not null references public.tenants(id) on delete cascade,
  creator_user_id uuid not null references public.users(id) on delete cascade,
  creator_display_name text,
  eligibility_score numeric(5,2) not null check (eligibility_score >= 95 and eligibility_score <= 100),
  creator_opted_in boolean not null default false,
  status public.premium_recipe_status not null default 'published',
  published_at timestamp with time zone,
  withdrawn_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint uq_premium_recipe_source unique (source_recipe_history_id),
  constraint chk_premium_recipe_publish_guard check (
    (status = 'published' and creator_opted_in = true and published_at is not null and withdrawn_at is null)
    or
    (status in ('withdrawn', 'moderation_hidden'))
  )
);

create index if not exists idx_premium_recipes_status
  on public.premium_recipes (status);

create index if not exists idx_premium_recipes_creator
  on public.premium_recipes (creator_user_id);

create index if not exists idx_premium_recipes_source_tenant
  on public.premium_recipes (source_tenant_id);

create table if not exists public.premium_recipe_reviews (
  id uuid primary key default gen_random_uuid(),
  premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint chk_premium_recipe_reviews_comment_len check (char_length(coalesce(comment, '')) <= 500)
);

create unique index if not exists uq_premium_recipe_reviews_member_recipe
  on public.premium_recipe_reviews (premium_recipe_id, user_id);

create index if not exists idx_premium_recipe_reviews_recipe
  on public.premium_recipe_reviews (premium_recipe_id, created_at desc);

create table if not exists public.premium_review_reports (
  id uuid primary key default gen_random_uuid(),
  premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
  review_id uuid references public.premium_recipe_reviews(id) on delete cascade,
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  status public.premium_report_status not null default 'open',
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  resolved_at timestamp with time zone,
  constraint chk_premium_review_reports_reason_not_blank check (char_length(btrim(reason)) > 0)
);

create index if not exists idx_premium_review_reports_status
  on public.premium_review_reports (status, created_at desc);

create index if not exists idx_premium_review_reports_recipe
  on public.premium_review_reports (premium_recipe_id);

alter table public.premium_recipes enable row level security;
alter table public.premium_recipe_reviews enable row level security;
alter table public.premium_review_reports enable row level security;

-- premium_recipes policies

drop policy if exists "Authenticated users can read published premium recipes" on public.premium_recipes;
create policy "Authenticated users can read published premium recipes"
  on public.premium_recipes
  for select
  using (auth.uid() is not null and status = 'published');

drop policy if exists "Creators can read own premium recipes" on public.premium_recipes;
create policy "Creators can read own premium recipes"
  on public.premium_recipes
  for select
  using (creator_user_id = auth.uid());

drop policy if exists "Creators can insert own premium recipes" on public.premium_recipes;
create policy "Creators can insert own premium recipes"
  on public.premium_recipes
  for insert
  with check (
    creator_user_id = auth.uid()
    and creator_opted_in = true
    and status = 'published'
    and published_at is not null
    and exists (
      select 1
      from public.recipe_ai_history h
      where h.id = source_recipe_history_id
        and h.tenant_id = source_tenant_id
        and h.user_id = auth.uid()
    )
  );

drop policy if exists "Creators can withdraw own premium recipes" on public.premium_recipes;
create policy "Creators can withdraw own premium recipes"
  on public.premium_recipes
  for update
  using (creator_user_id = auth.uid())
  with check (
    creator_user_id = auth.uid()
    and (
      status = 'withdrawn'
      or (status = 'published' and creator_opted_in = true and published_at is not null)
      or status = 'moderation_hidden'
    )
  );

drop policy if exists "Platform owners can manage premium recipes" on public.premium_recipes;
create policy "Platform owners can manage premium recipes"
  on public.premium_recipes
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

-- premium_recipe_reviews policies

drop policy if exists "Authenticated users can read reviews for published premium recipes" on public.premium_recipe_reviews;
create policy "Authenticated users can read reviews for published premium recipes"
  on public.premium_recipe_reviews
  for select
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.premium_recipes pr
      where pr.id = premium_recipe_id
        and pr.status = 'published'
    )
  );

drop policy if exists "Members can write own reviews for published premium recipes" on public.premium_recipe_reviews;
create policy "Members can write own reviews for published premium recipes"
  on public.premium_recipe_reviews
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.premium_recipes pr
      where pr.id = premium_recipe_id
        and pr.status = 'published'
    )
  );

drop policy if exists "Members can update own reviews for published premium recipes" on public.premium_recipe_reviews;
create policy "Members can update own reviews for published premium recipes"
  on public.premium_recipe_reviews
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.premium_recipes pr
      where pr.id = premium_recipe_id
        and pr.status = 'published'
    )
  );

drop policy if exists "Members can delete own reviews" on public.premium_recipe_reviews;
create policy "Members can delete own reviews"
  on public.premium_recipe_reviews
  for delete
  using (user_id = auth.uid());

drop policy if exists "Platform owners can manage premium recipe reviews" on public.premium_recipe_reviews;
create policy "Platform owners can manage premium recipe reviews"
  on public.premium_recipe_reviews
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

-- premium_review_reports policies

drop policy if exists "Members can report published premium recipes or reviews" on public.premium_review_reports;
create policy "Members can report published premium recipes or reviews"
  on public.premium_review_reports
  for insert
  with check (
    reporter_user_id = auth.uid()
    and exists (
      select 1
      from public.premium_recipes pr
      where pr.id = premium_recipe_id
        and pr.status = 'published'
    )
  );

drop policy if exists "Reporters can read own premium reports" on public.premium_review_reports;
create policy "Reporters can read own premium reports"
  on public.premium_review_reports
  for select
  using (reporter_user_id = auth.uid());

drop policy if exists "Platform owners can manage premium reports" on public.premium_review_reports;
create policy "Platform owners can manage premium reports"
  on public.premium_review_reports
  for all
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

commit;
