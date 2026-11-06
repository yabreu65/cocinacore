import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
const enabled = process.env.COCINACORE_SIGNUP_BOOTSTRAP_TEST === '1';
let admin: Pool;
let auth: Pool;
let runtime: Pool;
const fn = 'select * from public.signup_new_account($1,$2,$3,now(),$4)';
describe.skipIf(!enabled)('signup bootstrap candidate on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const urls = ['SIGNUP_TEST_ADMIN_URL', 'AUTH_DATABASE_URL', 'DATABASE_URL'].map(
      (k) => new URL(process.env[k] ?? '')
    );
    if (
      urls.some(
        (u) =>
          u.hostname !== '127.0.0.1' ||
          u.pathname !== '/signup_real_disposable' ||
          u.host !== urls[0].host
      ) ||
      urls[1].username !== 'cocinacore_auth' ||
      urls[2].username !== 'cocinacore_runtime_rls'
    )
      throw new Error('Disposable database required');
    admin = new Pool({ connectionString: urls[0].toString() });
    auth = new Pool({ connectionString: urls[1].toString() });
    runtime = new Pool({ connectionString: urls[2].toString() });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0].marker !== 'cocinacore-signup-real-disposable')
      throw new Error('Disposable marker required');
  });
  afterAll(async () => {
    await Promise.all([admin?.end(), auth?.end(), runtime?.end()]);
  });
  it('creates a new tenant, user and owner membership with FORCE RLS and rejects duplicates', async () => {
    const email = `bootstrap-${randomUUID()}@example.test`;
    const args = [email, 'hash', 'Test', 'v1'];
    const row = (await auth.query<{ user_id: string; tenant_id: string }>(fn, args)).rows[0];
    const record = await admin.query<{ role: string; tenant_id: string }>(
      'select m.role,m.tenant_id from users u join tenant_memberships m on m.user_id=u.id where u.id=$1 and u.email=$2',
      [row.user_id, email]
    );
    expect(record.rows).toEqual([{ role: 'owner', tenant_id: row.tenant_id }]);
    await expect(auth.query(fn, args)).rejects.toMatchObject({ code: '23505' });
    expect(
      (await admin.query('select id from tenants where name=$1', [`Tenant of ${email}`])).rowCount
    ).toBe(1);
  });
  it('denies direct inserts, public and runtime execution, and role escalation', async () => {
    const email = `existing-user-${randomUUID()}@example.test`;
    const owner = (
      await auth.query<{ user_id: string; tenant_id: string }>(fn, [
        email,
        'hash',
        'Existing user',
        'v1',
      ])
    ).rows[0];
    await admin.query('delete from public.tenant_memberships where tenant_id=$1 and user_id=$2', [
      owner.tenant_id,
      owner.user_id,
    ]);
    for (const sql of [
      "insert into tenants(name) values('x')",
      "insert into users(email,password_hash) values('x@example.test','x')",
      'set role cocinacore_signup_bootstrap',
    ])
      await expect(auth.query(sql)).rejects.toMatchObject({ code: '42501' });
    await expect(
      auth.query("insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')", [
        owner.tenant_id,
        owner.user_id,
      ])
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query(fn, ['x@example.test', 'hash', 'x', 'v1'])).rejects.toMatchObject({
      code: '42501',
    });
    const p = await admin.query<{
      public_execute: boolean;
      force_count: number;
      login: boolean;
      superuser: boolean;
      bypass: boolean;
      memberships: number;
    }>(
      `select has_function_privilege('public','public.signup_new_account(text,text,text,timestamp with time zone,text)','EXECUTE') public_execute, (select count(*)::int from pg_class where oid=any(array['public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass]) and relrowsecurity and relforcerowsecurity) force_count, r.rolcanlogin login,r.rolsuper superuser,r.rolbypassrls bypass,(select count(*)::int from pg_auth_members where member=r.oid or roleid=r.oid) memberships from pg_roles r where r.rolname='cocinacore_signup_bootstrap'`
    );
    expect(p.rows[0]).toEqual({
      public_execute: false,
      force_count: 3,
      login: false,
      superuser: false,
      bypass: false,
      memberships: 0,
    });
    await expect(
      auth.query('select * from public.signup_new_account($1,$2,$3,now(),$4,$5)', [
        'a',
        'b',
        'c',
        'd',
        randomUUID(),
      ])
    ).rejects.toMatchObject({ code: '42883' });
  });
  it('rolls back when membership insertion fails', async () => {
    const email = `rollback-${randomUUID()}@example.test`;
    await admin.query(
      "create function bootstrap_test_fail() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$; create trigger bootstrap_test_fail before insert on tenant_memberships for each row execute function bootstrap_test_fail()"
    );
    try {
      await expect(auth.query(fn, [email, 'hash', 'Test', 'v1'])).rejects.toThrow();
      expect((await admin.query('select id from users where email=$1', [email])).rowCount).toBe(0);
      expect(
        (await admin.query('select id from tenants where name=$1', [`Tenant of ${email}`])).rowCount
      ).toBe(0);
    } finally {
      await admin.query(
        'drop trigger bootstrap_test_fail on tenant_memberships; drop function bootstrap_test_fail()'
      );
    }
  });
  it('denies direct function execution to an independent login without grants', async () => {
    await admin.query("create role signup_no_capability login password 'disposable_only'");
    const url = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    url.username = 'signup_no_capability';
    url.password = 'disposable_only';
    const independent = new Pool({ connectionString: url.toString() });
    try {
      expect(
        (await independent.query<{ current_user: string }>('select current_user')).rows[0]
          .current_user
      ).toBe('signup_no_capability');
      await expect(
        independent.query(fn, ['independent@example.test', 'hash', 'test', 'v1'])
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await independent.end();
      await admin.query('drop role signup_no_capability');
    }
  });
});
