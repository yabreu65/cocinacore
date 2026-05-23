-- Premium board security and behavior fixtures.
-- Covers: no-opt-in publish denial, cross-tenant read-only, duplicate review prevention, withdrawal visibility.

begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

insert into public.tenants (id, name, tenant_type)
values
  ('30000000-0000-0000-0000-000000000003', 'Premium Tenant A', 'home'),
  ('40000000-0000-0000-0000-000000000004', 'Premium Tenant B', 'professional')
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    'aaaaaaaa-aaaa-0000-0000-000000000011',
    'premium-creator@example.test',
    '{"tenant_id":"30000000-0000-0000-0000-000000000003","role":"member"}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-0000-0000-000000000022',
    'premium-reader@example.test',
    '{"tenant_id":"40000000-0000-0000-0000-000000000004","role":"member"}'::jsonb
  ),
  (
    'cccccccc-cccc-0000-0000-000000000033',
    'premium-owner@example.test',
    '{"tenant_id":"30000000-0000-0000-0000-000000000003","role":"superadmin"}'::jsonb
  )
on conflict (id) do nothing;

insert into public.recipe_ai_history (
  id,
  tenant_id,
  user_id,
  source,
  recipe_title,
  recipe_payload,
  restrictions_snapshot,
  inventory_snapshot
)
values
  (
    '50000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-0000-0000-000000000011',
    'ai_generation',
    'Premium Risotto',
    '{"steps":["mix","cook"]}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb
  )
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-0000-0000-000000000011', true);

select extensions.throws_ok(
  $$insert into public.premium_recipes (
      id,
      source_recipe_history_id,
      source_tenant_id,
      creator_user_id,
      eligibility_score,
      creator_opted_in,
      status,
      published_at
    ) values (
      '60000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000003',
      'aaaaaaaa-aaaa-0000-0000-000000000011',
      97.50,
      false,
      'published',
      timezone('utc'::text, now())
    )$$,
  '42501',
  'No opt-in publish is denied by policy'
);

insert into public.premium_recipes (
  id,
  source_recipe_history_id,
  source_tenant_id,
  creator_user_id,
  eligibility_score,
  creator_opted_in,
  status,
  published_at
)
values (
  '60000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-0000-0000-000000000011',
  98.10,
  true,
  'published',
  timezone('utc'::text, now())
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-0000-0000-000000000022', true);

select extensions.is(
  (select count(*)::integer from public.premium_recipes where id = '60000000-0000-0000-0000-000000000002'),
  1,
  'Cross-tenant authenticated member can read published premium recipe'
);

select extensions.throws_ok(
  $$update public.premium_recipes
      set creator_display_name = 'Hijacked'
    where id = '60000000-0000-0000-0000-000000000002'$$,
  '42501',
  'Cross-tenant member cannot mutate premium recipe (read-only)'
);

insert into public.premium_recipe_reviews (
  id,
  premium_recipe_id,
  user_id,
  stars,
  comment
)
values (
  '70000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000002',
  'bbbbbbbb-bbbb-0000-0000-000000000022',
  5,
  'Great recipe'
);

select extensions.is(
  (select count(*)::integer from public.premium_recipe_reviews where id = '70000000-0000-0000-0000-000000000001'),
  1,
  'First review by member is accepted'
);

select extensions.throws_ok(
  $$insert into public.premium_recipe_reviews (
      premium_recipe_id,
      user_id,
      stars,
      comment
    ) values (
      '60000000-0000-0000-0000-000000000002',
      'bbbbbbbb-bbbb-0000-0000-000000000022',
      4,
      'Second try'
    )$$,
  '23505',
  'Duplicate member review insert is blocked by uniqueness constraint'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-0000-0000-000000000011', true);

select extensions.is(
  (with updated as (
    update public.premium_recipes
    set status = 'withdrawn',
        withdrawn_at = timezone('utc'::text, now())
    where id = '60000000-0000-0000-0000-000000000002'
    returning id
  )
  select count(*)::integer from updated),
  1,
  'Creator can withdraw own published premium recipe'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-0000-0000-0000-000000000022', true);

select extensions.is(
  (select count(*)::integer from public.premium_recipes where id = '60000000-0000-0000-0000-000000000002'),
  0,
  'Withdrawn recipe is hidden from public authenticated users'
);

select set_config('request.jwt.claim.sub', 'cccccccc-cccc-0000-0000-000000000033', true);

select extensions.is(
  (select count(*)::integer from public.premium_recipes where id = '60000000-0000-0000-0000-000000000002'),
  1,
  'Platform owner can still read withdrawn premium recipe'
);

select * from extensions.finish();
rollback;
