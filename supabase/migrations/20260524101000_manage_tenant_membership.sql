-- Manage tenant membership operations for owner/admin flows

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

  delete from public.users
  where id = v_member.id
    and tenant_id = v_actor.tenant_id;
end;
$$;

revoke all on function public.remove_tenant_member(uuid) from public;
grant execute on function public.remove_tenant_member(uuid) to authenticated;
