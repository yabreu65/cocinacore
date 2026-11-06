-- Disposable-cluster-only instrumentation. All functions run as the HTTP caller.
create schema smoke_fixture;
revoke all on schema smoke_fixture from public;
grant usage on schema smoke_fixture to cocinacore_runtime_rls;
create table smoke_fixture.observations (
  observed_at timestamptz not null default clock_timestamp(),
  relation_name text not null, operation text not null,
  effective_user text not null, login_user text not null, backend_pid integer not null,
  tenant_context text, user_context text, row_tenant text, row_user text
);
grant insert on smoke_fixture.observations to cocinacore_runtime_rls;
create function smoke_fixture.observe() returns trigger language plpgsql security invoker as $$
begin
  insert into smoke_fixture.observations
    (relation_name, operation, effective_user, login_user, backend_pid,
     tenant_context, user_context, row_tenant, row_user)
  values (tg_table_name, tg_op, current_user, session_user, pg_backend_pid(),
    nullif(current_setting('app.tenant_id', true), ''),
    nullif(current_setting('app.user_id', true), ''),
    to_jsonb(new)->>'tenant_id', to_jsonb(new)->>'user_id');
  return new;
end $$;
revoke all on function smoke_fixture.observe() from public;
create trigger smoke_observe_users after insert on public.users
  for each row execute function smoke_fixture.observe();
create trigger smoke_observe_sessions after insert or update on public.sessions
  for each row execute function smoke_fixture.observe();
create trigger smoke_observe_recipes after insert or update on public.user_recipes
  for each row execute function smoke_fixture.observe();
create trigger smoke_observe_cooking after insert or update on public.cooking_sessions
  for each row execute function smoke_fixture.observe();

create function smoke_fixture.fail_signup() returns trigger language plpgsql security invoker as $$
begin
  if exists (select 1 from public.users where id = new.user_id
             and email = tg_argv[0]) then
    raise exception 'SMOKE_SIGNUP_FAULT_%', tg_table_name;
  end if;
  return new;
end $$;
revoke all on function smoke_fixture.fail_signup() from public;
create trigger smoke_membership_fault after insert on public.tenant_memberships
  for each row execute function smoke_fixture.fail_signup('rollback-membership@smoke.invalid');
-- This fault fires on COMMIT, after the handler has prepared its session cookie.
create constraint trigger smoke_commit_fault after insert on public.sessions
  deferrable initially deferred for each row
  execute function smoke_fixture.fail_signup('rollback-commit@smoke.invalid');
