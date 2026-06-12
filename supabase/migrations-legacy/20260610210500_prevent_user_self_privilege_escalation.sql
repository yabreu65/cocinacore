begin;

create or replace function public.prevent_user_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if current_setting('app.accepting_tenant_invitation', true) = 'true'
    or current_setting('app.updating_tenant_member_role', true) = 'true' then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.role is distinct from old.role then
      raise exception 'Users cannot change their own role';
    end if;

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Users cannot change their own tenant';
    end if;
  end if;

  if not public.is_platform_owner() then
    if new.role is distinct from old.role then
      raise exception 'Only platform owners can change tenant member roles directly';
    end if;

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Only platform owners can change tenant membership directly';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_direct_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;

  if current_setting('app.removing_tenant_member', true) = 'true' then
    return old;
  end if;

  if not public.is_platform_owner() then
    raise exception 'Use controlled membership RPCs to remove users';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_user_self_privilege_escalation on public.users;

create trigger prevent_user_self_privilege_escalation
before update on public.users
for each row
execute function public.prevent_user_self_privilege_escalation();

drop trigger if exists prevent_direct_user_delete on public.users;

create trigger prevent_direct_user_delete
before delete on public.users
for each row
execute function public.prevent_direct_user_delete();

alter table public.platform_owners
  add column if not exists requires_manual_review boolean not null default true;

update public.platform_owners po
set requires_manual_review = true
where requires_manual_review = false;

create or replace function public.is_platform_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_owners po
    where po.user_id = auth.uid()
      and po.requires_manual_review = false
  );
$$;

create or replace function public.prevent_tenant_sensitive_direct_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_platform_owner() and (
    new.tenant_type is distinct from old.tenant_type
    or new.trial_started_at is distinct from old.trial_started_at
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.trial_soft_blocked_at is distinct from old.trial_soft_blocked_at
  ) then
    raise exception 'Only reviewed platform owners can change tenant entitlement fields';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_tenant_type_direct_change on public.tenants;
drop trigger if exists prevent_tenant_sensitive_direct_change on public.tenants;

create trigger prevent_tenant_sensitive_direct_change
before update on public.tenants
for each row
execute function public.prevent_tenant_sensitive_direct_change();

drop policy if exists "Reviewed platform owners can update tenants" on public.tenants;
create policy "Reviewed platform owners can update tenants"
  on public.tenants
  for update
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create or replace function public.approve_platform_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'Platform owner review must be performed by a database administrator';
  end if;

  update public.platform_owners
  set requires_manual_review = false
  where user_id = p_user_id;

  if not found then
    raise exception 'Platform owner row not found';
  end if;
end;
$$;

revoke all on function public.approve_platform_owner(uuid) from public;

create or replace function public.update_tenant_member_role(
  p_member_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.users%rowtype;
  v_member public.users%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_role not in ('admin', 'member') then
    raise exception 'Invalid member role';
  end if;

  select * into v_actor
  from public.users
  where id = v_actor_id;

  if v_actor.id is null or v_actor.tenant_id is null then
    raise exception 'Actor is not attached to a tenant';
  end if;

  if v_actor.role <> 'owner' then
    raise exception 'Only tenant owners can change member roles';
  end if;

  select * into v_member
  from public.users
  where id = p_member_id
  for update;

  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if v_member.tenant_id is distinct from v_actor.tenant_id then
    raise exception 'Cannot update users from another tenant';
  end if;

  if v_member.id = v_actor.id then
    raise exception 'You cannot change your own role';
  end if;

  if v_member.role = 'owner' then
    raise exception 'Owner role cannot be changed';
  end if;

  perform set_config('app.updating_tenant_member_role', 'true', true);

  update public.users
  set role = p_role
  where id = v_member.id
    and tenant_id = v_actor.tenant_id;
end;
$$;

revoke all on function public.update_tenant_member_role(uuid, text) from public;
grant execute on function public.update_tenant_member_role(uuid, text) to authenticated;

create or replace function public.remove_tenant_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.users%rowtype;
  v_member public.users%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.users
  where id = v_actor_id;

  if v_actor.id is null or v_actor.tenant_id is null then
    raise exception 'Actor is not attached to a tenant';
  end if;

  if v_actor.role not in ('owner', 'admin') then
    raise exception 'Only owner/admin can remove members';
  end if;

  select * into v_member
  from public.users
  where id = p_member_id
  for update;

  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if v_member.tenant_id is distinct from v_actor.tenant_id then
    raise exception 'Cannot remove users from another tenant';
  end if;

  if v_member.id = v_actor.id then
    raise exception 'You cannot remove your own user';
  end if;

  if v_member.role = 'owner' then
    raise exception 'Owner cannot be removed';
  end if;

  if v_actor.role = 'admin' and v_member.role = 'admin' then
    raise exception 'Admin cannot remove another admin';
  end if;

  perform set_config('app.removing_tenant_member', 'true', true);

  delete from public.users
  where id = v_member.id
    and tenant_id = v_actor.tenant_id;
end;
$$;

revoke all on function public.remove_tenant_member(uuid) from public;
grant execute on function public.remove_tenant_member(uuid) to authenticated;

create or replace function public.accept_tenant_invitation(p_invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_invitation public.tenant_invitations%rowtype;
begin
  v_user_id := auth.uid();
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_email = '' then
    raise exception 'Authenticated email claim required';
  end if;

  select *
  into v_invitation
  from public.tenant_invitations ti
  where ti.invitation_token = p_invitation_token
    and ti.status = 'pending'
    and ti.expires_at >= timezone('utc'::text, now())
    and lower(ti.email) = v_email
  for update;

  if not found then
    raise exception 'Invitation invalid, expired, or not available for this user';
  end if;

  perform set_config('app.accepting_tenant_invitation', 'true', true);

  insert into public.users (id, tenant_id, email, role)
  values (v_user_id, v_invitation.tenant_id, v_invitation.email, 'member')
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        email = excluded.email,
        role = 'member';

  update public.tenant_invitations
  set status = 'accepted',
      accepted_at = timezone('utc'::text, now()),
      accepted_by = v_user_id
  where id = v_invitation.id;

  return v_invitation.tenant_id;
end;
$$;

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
  v_tenant_name := coalesce(new.raw_user_meta_data ->> 'tenant_name', 'Default Tenant');
  v_role := 'member';
  v_tenant_type := 'home'::public.tenant_type;
  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );
  v_terms_accepted_at := (new.raw_user_meta_data ->> 'terms_accepted_at')::timestamp with time zone;
  v_terms_version := nullif(new.raw_user_meta_data ->> 'terms_version', '');

  insert into public.tenants (name, tenant_type)
  values (v_tenant_name, v_tenant_type)
  returning id into v_tenant_id;

  insert into public.users (id, tenant_id, email, role, full_name, terms_accepted_at, terms_version)
  values (new.id, v_tenant_id, new.email, v_role, v_full_name, v_terms_accepted_at, v_terms_version)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        email = excluded.email,
        role = excluded.role,
        full_name = excluded.full_name,
        terms_accepted_at = excluded.terms_accepted_at,
        terms_version = excluded.terms_version;

  return new;
end;
$$;

commit;
