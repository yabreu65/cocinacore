-- Migration 007: Database functions that replace Supabase RPCs
-- All functions receive user/tenant context explicitly instead of relying on auth.uid().

-- ==========================================
-- 1. SEMANTIC SEARCH (replaces match_chunks RPC)
-- ==========================================
create or replace function public.match_chunks(
    p_query_embedding vector(1536),
    p_match_threshold double precision,
    p_match_count int,
    p_filter_tenant_id uuid
)
returns table (
    id uuid,
    content text,
    similarity double precision,
    metadata jsonb,
    tenant_id uuid,
    global_book_id uuid,
    tenant_book_id uuid,
    source_type text
)
language sql
stable
as $$
    select
        bc.id,
        bc.content,
        1 - (bc.embedding <=> p_query_embedding) as similarity,
        bc.metadata,
        bc.tenant_id,
        bc.global_book_id,
        bc.tenant_book_id,
        bc.source_type
    from public.book_chunks bc
    where
        (p_filter_tenant_id is null or bc.tenant_id is null or bc.tenant_id = p_filter_tenant_id)
        and (1 - (bc.embedding <=> p_query_embedding)) > p_match_threshold
    order by bc.embedding <=> p_query_embedding
    limit p_match_count;
$$;

comment on function public.match_chunks is 'Cosine similarity search over book_chunks with explicit tenant filtering.';

-- ==========================================
-- 2. PLATFORM OWNER CHECK
-- ==========================================
create or replace function public.is_platform_owner(p_user_id uuid)
returns boolean
language sql
stable
as $$
    select coalesce(
        exists (
            select 1
            from public.platform_owners po
            where po.user_id = p_user_id
              and po.requires_manual_review = false
        ),
        false
    );
$$;

comment on function public.is_platform_owner is 'Returns true if the user is an approved platform owner.';

-- ==========================================
-- 3. TENANT MEMBER MANAGEMENT
-- ==========================================
create or replace function public.remove_tenant_member(
    p_actor_user_id uuid,
    p_member_id uuid
)
returns void
language plpgsql
as $$
declare
    v_actor_role text;
    v_target_tenant_id uuid;
begin
    select role into v_actor_role
    from public.users
    where id = p_actor_user_id;

    if v_actor_role not in ('owner', 'admin') then
        raise exception 'Insufficient privileges';
    end if;

    select tenant_id into v_target_tenant_id
    from public.users
    where id = p_member_id;

    if v_target_tenant_id is null then
        raise exception 'Member not found';
    end if;

    if not exists (
        select 1 from public.users
        where id = p_actor_user_id and tenant_id = v_target_tenant_id
    ) then
        raise exception 'Actor and target must belong to the same tenant';
    end if;

    delete from public.tenant_memberships
    where user_id = p_member_id and tenant_id = v_target_tenant_id;

    update public.users
    set tenant_id = null,
        role = 'member',
        updated_at = now()
    where id = p_member_id;
end;
$$;

comment on function public.remove_tenant_member is 'Removes a member from their tenant.';

create or replace function public.update_tenant_member_role(
    p_actor_user_id uuid,
    p_member_id uuid,
    p_role text
)
returns void
language plpgsql
as $$
declare
    v_actor_role text;
    v_target_tenant_id uuid;
begin
    if p_role not in ('admin', 'member') then
        raise exception 'Invalid target role';
    end if;

    select role into v_actor_role
    from public.users
    where id = p_actor_user_id;

    if v_actor_role <> 'owner' then
        raise exception 'Only owner can change roles';
    end if;

    select tenant_id into v_target_tenant_id
    from public.users
    where id = p_member_id;

    if v_target_tenant_id is null then
        raise exception 'Member not found';
    end if;

    if not exists (
        select 1 from public.users
        where id = p_actor_user_id and tenant_id = v_target_tenant_id
    ) then
        raise exception 'Actor and target must belong to the same tenant';
    end if;

    update public.tenant_memberships
    set role = p_role,
        updated_at = now()
    where user_id = p_member_id and tenant_id = v_target_tenant_id;

    update public.users
    set role = p_role,
        updated_at = now()
    where id = p_member_id;
end;
$$;

comment on function public.update_tenant_member_role is 'Updates a tenant member role.';

-- ==========================================
-- 4. ACCEPT TENANT INVITATION
-- ==========================================
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

    if lower(v_user_email) <> lower(v_invitation.email) then
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

comment on function public.accept_tenant_invitation is 'Accepts a pending tenant invitation for a user.';

-- ==========================================
-- 5. OWNER OVERVIEW METRICS
-- ==========================================
create or replace function public.get_owner_overview_metrics()
returns jsonb
language sql
stable
as $$
    select jsonb_build_object(
        'tenants', (select count(*) from public.tenants),
        'users', (select count(*) from public.users),
        'recipes_generated', (select count(*) from public.recipe_ai_history),
        'pdfs_uploaded', (select count(*) from public.tenant_pdf_library),
        'premium_recipes', (select count(*) from public.premium_recipes where status = 'published')
    );
$$;

comment on function public.get_owner_overview_metrics is 'Aggregate metrics for the platform owner dashboard.';

-- ==========================================
-- 6. APPROVE PLATFORM OWNER
-- ==========================================
create or replace function public.approve_platform_owner(p_user_id uuid)
returns void
language sql
as $$
    insert into public.platform_owners (user_id, requires_manual_review)
    values (p_user_id, false)
    on conflict (user_id) do update
    set requires_manual_review = false;
$$;

comment on function public.approve_platform_owner is 'Approves a user as platform owner.';
