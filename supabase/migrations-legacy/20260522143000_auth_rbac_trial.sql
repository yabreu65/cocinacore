-- Migration: Auth RBAC invitations + trial soft-block foundations

begin;

-- 1) Tenant trial lifecycle fields (14-day trial)
alter table public.tenants
  add column if not exists trial_started_at timestamp with time zone,
  add column if not exists trial_ends_at timestamp with time zone,
  add column if not exists trial_soft_blocked_at timestamp with time zone;

update public.tenants
set trial_started_at = coalesce(trial_started_at, created_at),
    trial_ends_at = coalesce(trial_ends_at, created_at + interval '14 days')
where trial_started_at is null
   or trial_ends_at is null;

alter table public.tenants
  alter column trial_started_at set default timezone('utc'::text, now()),
  alter column trial_ends_at set default (timezone('utc'::text, now()) + interval '14 days');

alter table public.tenants
  alter column trial_started_at set not null,
  alter column trial_ends_at set not null;

-- 2) Invitations table (member-only role for MVP)
create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.users(id) on delete restrict,
  role text not null default 'member',
  invitation_token text not null unique,
  status text not null default 'pending',
  expires_at timestamp with time zone not null default (timezone('utc'::text, now()) + interval '30 days'),
  accepted_at timestamp with time zone,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint tenant_invitations_role_check check (role = 'member'),
  constraint tenant_invitations_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create index if not exists idx_tenant_invitations_tenant_id
  on public.tenant_invitations (tenant_id);

create index if not exists idx_tenant_invitations_email
  on public.tenant_invitations (lower(email));

create unique index if not exists uq_tenant_invitations_pending_email
  on public.tenant_invitations (tenant_id, lower(email))
  where status = 'pending';

-- 3) RBAC + trial helpers (preserve owner/admin/member model)
create or replace function public.is_tenant_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.tenant_id = public.get_auth_tenant_id()
      and u.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.can_manage_tenant_members()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(u.role in ('owner', 'admin'), false)
  from public.users u
  where u.id = auth.uid()
    and u.tenant_id = public.get_auth_tenant_id();
$$;

create or replace function public.is_trial_active(p_tenant_id uuid default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(t.trial_ends_at >= timezone('utc'::text, now()), false)
  from public.tenants t
  where t.id = coalesce(p_tenant_id, public.get_auth_tenant_id());
$$;

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

-- 4) Invitation RLS policies (owner/admin manage; invitee self-read)
alter table public.tenant_invitations enable row level security;

drop policy if exists "Tenant admins can create invitations" on public.tenant_invitations;
create policy "Tenant admins can create invitations"
  on public.tenant_invitations
  for insert
  with check (
    tenant_id = public.get_auth_tenant_id()
    and invited_by = auth.uid()
    and public.can_manage_tenant_members()
    and role = 'member'
  );

drop policy if exists "Tenant admins can read invitations" on public.tenant_invitations;
create policy "Tenant admins can read invitations"
  on public.tenant_invitations
  for select
  using (
    tenant_id = public.get_auth_tenant_id()
    and public.can_manage_tenant_members()
  );

drop policy if exists "Tenant admins can update invitations" on public.tenant_invitations;
create policy "Tenant admins can update invitations"
  on public.tenant_invitations
  for update
  using (
    tenant_id = public.get_auth_tenant_id()
    and public.can_manage_tenant_members()
  )
  with check (
    tenant_id = public.get_auth_tenant_id()
    and public.can_manage_tenant_members()
    and role = 'member'
  );

drop policy if exists "Tenant admins can delete invitations" on public.tenant_invitations;
create policy "Tenant admins can delete invitations"
  on public.tenant_invitations
  for delete
  using (
    tenant_id = public.get_auth_tenant_id()
    and public.can_manage_tenant_members()
  );

drop policy if exists "Invitee can read own pending invitation" on public.tenant_invitations;
create policy "Invitee can read own pending invitation"
  on public.tenant_invitations
  for select
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
    and expires_at >= timezone('utc'::text, now())
  );

commit;
