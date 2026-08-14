lock table public.users in access exclusive mode;

do $$
declare
    v_collision_groups bigint;
begin
    select count(*)
    into v_collision_groups
    from (
        select pg_catalog.lower(pg_catalog.btrim(email))
        from public.users
        where pg_catalog.lower(pg_catalog.btrim(email)) <> ''
        group by pg_catalog.lower(pg_catalog.btrim(email))
        having count(*) > 1
    ) as canonical_collisions;

    if v_collision_groups > 0 then
        raise exception using
            errcode = '23505',
            message = 'CANONICAL_EMAIL_COLLISION',
            detail = pg_catalog.format('%s canonical collision group(s)', v_collision_groups);
    end if;
end;
$$;

do $$
begin
    if exists (
        select 1
        from public.users
        where pg_catalog.lower(pg_catalog.btrim(email)) = ''
    ) then
        raise exception using
            errcode = '23514',
            message = 'CANONICAL_EMAIL_EMPTY';
    end if;
end;
$$;

update public.users
set email = pg_catalog.lower(pg_catalog.btrim(email))
where email is distinct from pg_catalog.lower(pg_catalog.btrim(email));

alter table public.users
add constraint users_email_canonical_check
check (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    and email <> ''
);

create or replace function public.accept_tenant_invitation(
    p_user_id uuid,
    p_invitation_token text
)
returns text
language plpgsql
as $$
declare
    v_invitation public.tenant_invitations%rowtype;
    v_user_email text;
begin
    select * into v_invitation
    from public.tenant_invitations
    where invitation_token = p_invitation_token
      and status = 'pending'
      and expires_at > now()
    for update;

    if not found then
        raise exception 'Invalid or expired invitation';
    end if;

    select email into v_user_email
    from public.users
    where id = p_user_id;

    if v_user_email <> pg_catalog.lower(pg_catalog.btrim(v_invitation.email)) then
        raise exception 'Invitation email does not match user email';
    end if;

    update public.tenant_invitations
    set status = 'accepted',
        accepted_at = now(),
        accepted_by = p_user_id
    where id = v_invitation.id;

    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (v_invitation.tenant_id, p_user_id, v_invitation.role)
    on conflict (tenant_id, user_id) do update
    set role = v_invitation.role,
        updated_at = now();

    update public.users
    set tenant_id = v_invitation.tenant_id,
        role = v_invitation.role,
        updated_at = now()
    where id = p_user_id;

    return v_invitation.tenant_id::text;
end;
$$;
