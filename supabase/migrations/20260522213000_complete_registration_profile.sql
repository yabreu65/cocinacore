begin;

alter table public.users
  add column if not exists full_name text,
  add column if not exists terms_accepted_at timestamp with time zone,
  add column if not exists terms_version text;

update public.users u
set full_name = coalesce(
  nullif(au.raw_user_meta_data ->> 'full_name', ''),
  nullif(au.raw_user_meta_data ->> 'name', ''),
  split_part(u.email, '@', 1)
)
from auth.users au
where au.id = u.id
  and (u.full_name is null or btrim(u.full_name) = '');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_tenant_name text;
  v_role text;
  v_tenant_type public.tenant_type;
  v_full_name text;
  v_terms_accepted_at timestamp with time zone;
  v_terms_version text;
begin
  v_tenant_id := ((new.raw_user_meta_data ->> 'tenant_id')::uuid);
  v_tenant_name := coalesce(new.raw_user_meta_data ->> 'tenant_name', 'Default Tenant');
  v_role := coalesce(new.raw_user_meta_data ->> 'role', 'member');
  v_tenant_type := coalesce((new.raw_user_meta_data ->> 'tenant_type')::public.tenant_type, 'home'::public.tenant_type);
  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );
  v_terms_accepted_at := coalesce((new.raw_user_meta_data ->> 'terms_accepted_at')::timestamp with time zone, timezone('utc'::text, now()));
  v_terms_version := coalesce(nullif(new.raw_user_meta_data ->> 'terms_version', ''), 'v1');

  if v_role = 'user' then
    v_role := 'member';
  elsif v_role = 'superadmin' then
    v_role := 'owner';
  end if;

  if v_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role: %', v_role;
  end if;

  if v_tenant_id is null then
    insert into public.tenants (name, tenant_type)
    values (v_tenant_name, v_tenant_type)
    returning id into v_tenant_id;
  end if;

  insert into public.users (id, tenant_id, email, role, full_name, terms_accepted_at, terms_version)
  values (new.id, v_tenant_id, new.email, v_role, v_full_name, v_terms_accepted_at, v_terms_version)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        email = excluded.email,
        role = excluded.role,
        full_name = excluded.full_name,
        terms_accepted_at = excluded.terms_accepted_at,
        terms_version = excluded.terms_version;

  if coalesce(new.raw_user_meta_data ->> 'role', '') = 'superadmin' then
    insert into public.platform_owners (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

commit;
