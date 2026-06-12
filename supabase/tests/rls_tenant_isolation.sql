-- RLS tenant isolation fixtures for CocinaCore.
--
-- Purpose: executable allow/deny assertions for local Supabase DB tests.
-- Run after applying migrations in a Supabase test database with pgTAP available.
-- These assertions prove same-tenant access is allowed and cross-tenant access is denied.

begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

insert into public.tenants (id, name, tenant_type)
values
  ('10000000-0000-0000-0000-000000000001', 'Tenant A', 'home'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B', 'professional');

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'tenant-a@example.test',
    '{"tenant_id": "10000000-0000-0000-0000-000000000001", "role": "user"}'::jsonb
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    'tenant-b@example.test',
    '{"tenant_id": "20000000-0000-0000-0000-000000000002", "role": "user"}'::jsonb
  ),
  (
    'cccccccc-0000-0000-0000-000000000003',
    'platform-owner@example.test',
    '{"tenant_id": "10000000-0000-0000-0000-000000000001", "role": "superadmin", "tenant_type": "home"}'::jsonb
  ),
  (
    'dddddddd-0000-0000-0000-000000000004',
    'tenant-owner@example.test',
    '{"tenant_id": "10000000-0000-0000-0000-000000000001", "role": "owner", "tenant_type": "professional"}'::jsonb
  ),
  (
    'eeeeeeee-0000-0000-0000-000000000005',
    'tenant-member@example.test',
    '{"tenant_id": "10000000-0000-0000-0000-000000000001", "role": "member", "tenant_type": "home"}'::jsonb
  ),
  (
    'ffffffff-0000-0000-0000-000000000006',
    'invitee@example.test',
    '{"tenant_id": "10000000-0000-0000-0000-000000000001", "role": "member", "tenant_type": "home"}'::jsonb
  );

-- The migration trigger creates public.users profiles from auth.users metadata.
update public.users
set tenant_id = '10000000-0000-0000-0000-000000000001', role = 'owner'
where id = 'dddddddd-0000-0000-0000-000000000004';

update public.users
set tenant_id = '10000000-0000-0000-0000-000000000001', role = 'member'
where id in (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000005',
  'ffffffff-0000-0000-0000-000000000006'
);

update public.users
set tenant_id = '20000000-0000-0000-0000-000000000002', role = 'member'
where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.platform_owners (user_id, requires_manual_review)
values ('cccccccc-0000-0000-0000-000000000003', false)
on conflict (user_id) do update set requires_manual_review = false;

insert into public.tenant_books (id, tenant_id, title)
values
  ('11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Tenant A Book'),
  ('22222222-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Tenant B Book');

insert into public.global_books (id, title)
values ('33333333-0000-0000-0000-000000000003', 'Global PDF Book');

insert into public.book_chunks (id, tenant_id, global_book_id, tenant_book_id, content, embedding, source_type)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, '11111111-0000-0000-0000-000000000001', 'Tenant A private chunk', array_fill(0.01::real, array[1536])::vector, 'tenant_pdf'),
  ('bbbbbbbb-2222-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', null, '22222222-0000-0000-0000-000000000002', 'Tenant B private chunk', array_fill(0.02::real, array[1536])::vector, 'tenant_pdf'),
  ('cccccccc-3333-0000-0000-000000000003', null, '33333333-0000-0000-0000-000000000003', null, 'Global shared chunk', array_fill(0.015::real, array[1536])::vector, 'global_pdf');



-- Seed tenant PDF libraries for upload-limit assertions.
insert into public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
values
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tenants/a/a-1.pdf', 1200, 10, repeat('a', 64), 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'tenants/b/b-1.pdf', 1200, 10, repeat('b', 64), 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.tenant_books (id, tenant_id, title)
select
  (lpad(gs::text, 8, '2') || '-0000-0000-0000-000000000002')::uuid,
  '20000000-0000-0000-0000-000000000002'::uuid,
  format('Tenant B Book %s', gs)
from generate_series(2, 14) as gs;

insert into public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
select
  '20000000-0000-0000-0000-000000000002'::uuid,
  (lpad(gs::text, 8, '2') || '-0000-0000-0000-000000000002')::uuid,
  format('tenants/b/b-%s.pdf', gs),
  1100 + gs,
  5 + gs,
  lpad(to_hex(gs), 64, '0'),
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid
from generate_series(2, 14) as gs;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

select extensions.is(
  (select count(*)::integer from public.tenant_books where tenant_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'Tenant A can read its own tenant book'
);

select extensions.is(
  (select count(*)::integer from public.tenant_books where tenant_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'Tenant A cannot read Tenant B books'
);

select extensions.is(
  (select count(*)::integer from public.book_chunks where tenant_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'Tenant A can read its own chunks'
);

select extensions.is(
  (select count(*)::integer from public.book_chunks where tenant_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'Tenant A cannot read Tenant B chunks'
);

select extensions.throws_ok(
  $$insert into public.tenant_books (tenant_id, title) values ('20000000-0000-0000-0000-000000000002', 'Cross-tenant write')$$,
  '42501',
  'Tenant A cannot write a Tenant B book'
);

select extensions.throws_ok(
  $$insert into public.book_chunks (tenant_id, tenant_book_id, content, embedding) values ('20000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'Cross-tenant chunk', array_fill(0.03::real, array[1536])::vector)$$,
  '42501',
  'Tenant A cannot write Tenant B chunks'
);

select extensions.is(
  (with updated as (
    update public.tenant_books
    set title = 'Tenant A Book Updated'
    where id = '11111111-0000-0000-0000-000000000001'
    returning id
  )
  select count(*)::integer from updated),
  1,
  'Tenant A can update its own book'
);

select extensions.is(
  (with updated as (
    update public.tenant_books
    set title = 'Illegal cross-tenant update'
    where id = '22222222-0000-0000-0000-000000000002'
    returning id
  )
  select count(*)::integer from updated),
  0,
  'Tenant A cannot update Tenant B book'
);

select extensions.is(
  (
    select count(*)::integer
    from public.match_chunks(array_fill(0.01::real, array[1536])::vector, -1, 10, '10000000-0000-0000-0000-000000000001')
  ),
  2,
  'match_chunks returns only global + current tenant chunks'
);

select extensions.is(
  (
    select count(*)::integer
    from public.match_chunks(array_fill(0.01::real, array[1536])::vector, -1, 10, '10000000-0000-0000-0000-000000000001')
    where tenant_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'match_chunks excludes foreign tenant chunks'
);

select extensions.throws_ok(
  $$select count(*) from public.match_chunks(array_fill(0.01::real, array[1536])::vector, -1, 10, '20000000-0000-0000-0000-000000000002')$$,
  '42501',
  'match_chunks blocks cross-tenant filter parameter'
);

select extensions.throws_ok(
  $$insert into public.book_chunks (tenant_id, global_book_id, content, embedding, source_type) values ('10000000-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', 'bad source check', array_fill(0.03::real, array[1536])::vector, 'global_pdf')$$,
  '23514',
  'source_type constraint rejects mismatched global/tenant references'
);




-- Home tenant capped at 5 PDFs.
insert into public.tenant_books (id, tenant_id, title)
values
  ('11111111-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'Tenant A Book 2'),
  ('11111111-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'Tenant A Book 3'),
  ('11111111-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'Tenant A Book 4'),
  ('11111111-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'Tenant A Book 5'),
  ('11111111-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'Tenant A Book 6');

insert into public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
values
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000011', 'tenants/a/a-2.pdf', 1001, 11, repeat('c', 64), 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000012', 'tenants/a/a-3.pdf', 1002, 12, repeat('d', 64), 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000013', 'tenants/a/a-4.pdf', 1003, 13, repeat('e', 64), 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000014', 'tenants/a/a-5.pdf', 1004, 14, repeat('f', 64), 'aaaaaaaa-0000-0000-0000-000000000001');

select extensions.throws_ok(
  $$insert into public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by) values ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000015', 'tenants/a/a-6.pdf', 1005, 15, repeat('1', 64), 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'P0001',
  'Home tenant cannot upload a 6th PDF'
);

-- Professional tenant can upload 15th PDF.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);

insert into public.tenant_books (id, tenant_id, title)
values ('29999999-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Tenant B Book 15');

select extensions.is(
  (
    with inserted as (
      insert into public.tenant_pdf_library (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
      values ('20000000-0000-0000-0000-000000000002', '29999999-0000-0000-0000-000000000002', 'tenants/b/b-15.pdf', 1500, 15, repeat('2', 64), 'bbbbbbbb-0000-0000-0000-000000000002')
      returning id
    )
    select count(*)::integer from inserted
  ),
  1,
  'Professional tenant can upload 15th PDF'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

-- RBAC invitation role denial + invite validity/expiry checks.
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.email', 'tenant-owner@example.test', true);

select extensions.is(
  (with inserted as (
    insert into public.tenant_invitations (tenant_id, email, invited_by, role, invitation_token, expires_at)
    values (
      '10000000-0000-0000-0000-000000000001',
      'invitee@example.test',
      'dddddddd-0000-0000-0000-000000000004',
      'member',
      'valid-owner-invite-token',
      timezone('utc'::text, now()) + interval '30 days'
    )
    returning id
  )
  select count(*)::integer from inserted),
  1,
  'Owner can create tenant invitation'
);

select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
select set_config('request.jwt.claim.email', 'tenant-member@example.test', true);

select extensions.throws_ok(
  $$insert into public.tenant_invitations (tenant_id, email, invited_by, role, invitation_token, expires_at) values ('10000000-0000-0000-0000-000000000001', 'member-denied@example.test', 'eeeeeeee-0000-0000-0000-000000000005', 'member', 'member-denied-token', timezone('utc'::text, now()) + interval '30 days')$$,
  '42501',
  'Member cannot create invitations (role denial)'
);

select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claim.email', 'invitee@example.test', true);

select extensions.is(
  public.accept_tenant_invitation('valid-owner-invite-token'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Invitee can accept a valid invitation token'
);

insert into public.tenant_invitations (tenant_id, email, invited_by, role, invitation_token, expires_at)
values (
  '10000000-0000-0000-0000-000000000001',
  'invitee@example.test',
  'dddddddd-0000-0000-0000-000000000004',
  'member',
  'expired-invite-token',
  timezone('utc'::text, now()) - interval '1 day'
);

select extensions.throws_ok(
  $$select public.accept_tenant_invitation('expired-invite-token')$$,
  'P0001',
  'Expired invitation is rejected'
);



-- Platform owner can manage global books without tenant membership checks.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);

select extensions.is(
  (with inserted as (
    insert into public.global_books (id, title)
    values ('34444444-0000-0000-0000-000000000004', 'Platform Global Book')
    returning id
  )
  select count(*)::integer from inserted),
  1,
  'Platform Owner can insert global books without tenant membership policy'
);

-- Tenant owner (non-platform owner) cannot manage platform-only resources.
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);

select extensions.throws_ok(
  $$insert into public.global_books (id, title) values ('44444444-0000-0000-0000-000000000004', 'Tenant owner forbidden global write')$$,
  '42501',
  'Tenant Owner cannot manage platform-only global books'
);

select extensions.throws_ok(
  $$update public.tenants set tenant_type = 'professional' where id = '10000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'Tenant owner cannot change tenant type directly'
);

select extensions.throws_ok(
  $$update public.tenants set trial_ends_at = timezone('utc'::text, now()) + interval '10 years' where id = '10000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'Tenant owner cannot change trial entitlement fields directly'
);

select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);

select extensions.is(
  (with updated as (
    update public.tenants
    set tenant_type = 'professional'
    where id = '10000000-0000-0000-0000-000000000001'
    returning id
  )
  select count(*)::integer from updated),
  1,
  'Reviewed platform owner can change tenant type'
);

-- Invalid tenant type metadata is ignored by signup trigger and defaults to home.
select extensions.lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('99999999-0000-0000-0000-000000000009', 'bad-tenant-type@example.test', '{"role":"member","tenant_type":"enterprise"}'::jsonb)$$,
  'Invalid tenant type metadata is ignored'
);

select extensions.is(
  (
    select t.tenant_type::text
    from public.users u
    join public.tenants t on t.id = u.tenant_id
    where u.id = '99999999-0000-0000-0000-000000000009'
  ),
  'home',
  'Ignored invalid tenant type defaults to home'
);

-- Deny-by-default: RLS enabled table with no policy denies writes even with table grants.
create table public.rls_no_policy_probe (
  id integer primary key
);
alter table public.rls_no_policy_probe enable row level security;
grant select, insert on public.rls_no_policy_probe to authenticated;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

select extensions.throws_ok(
  $$insert into public.rls_no_policy_probe (id) values (1)$$,
  '42501',
  'RLS deny-by-default blocks insert when no policy applies'
);

select extensions.finish();
rollback;
