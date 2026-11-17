import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import { findPlatformOwnerForSession } from './platformOwnerRepository';
import { attestActivatedCapabilities } from '../../../../scripts/activated-capabilities-attestation';

const enabled = process.env.COCINACORE_FIRST_ADMIN_BOOTSTRAP_TEST === '1';
const bootstrap =
  'select * from public.provision_first_platform_administrator($1, $2, $3, $4)';
type ProvisionedUser = { user_id: string; email: string };
let admin: Pool;
let provisioner: Pool;
let auth: Pool;
let runtime: Pool;

describe.skipIf(!enabled)('first platform administrator bootstrap on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const adminUrl = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const provisionerUrl = new URL(process.env.FIRST_ADMIN_PROVISIONER_URL ?? '');
    const authUrl = new URL(process.env.AUTH_DATABASE_URL ?? '');
    const runtimeUrl = new URL(process.env.DATABASE_URL ?? '');
    const urls = [adminUrl, provisionerUrl, authUrl, runtimeUrl];
    if (
      urls.some(
        (url) =>
          url.hostname !== '127.0.0.1' ||
          url.pathname !== '/first_admin_disposable' ||
          url.host !== adminUrl.host
      ) ||
      provisionerUrl.username !== 'cocinacore_first_admin_provisioner' ||
      authUrl.username !== 'cocinacore_auth' ||
      runtimeUrl.username !== 'cocinacore_runtime_rls'
    ) {
      throw new Error('Disposable first-admin database lanes required');
    }
    admin = new Pool({ connectionString: adminUrl.toString() });
    provisioner = new Pool({ connectionString: provisionerUrl.toString() });
    auth = new Pool({ connectionString: authUrl.toString() });
    runtime = new Pool({ connectionString: runtimeUrl.toString() });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0]?.marker !== 'cocinacore-first-admin-disposable') {
      throw new Error('Disposable database marker required');
    }
    expect(await attestActivatedCapabilities(provisioner, '024')).toBe('active');
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), provisioner?.end(), auth?.end(), runtime?.end()]);
  });

  it('creates one active platform admin with member-only tenant context and denies other lanes', async () => {
    const before = await admin.query<{ users: number; owners: number; tenants: number; memberships: number }>(
      `select
         (select count(*)::int from public.users) users,
         (select count(*)::int from public.platform_owners) owners,
         (select count(*)::int from public.tenants) tenants,
         (select count(*)::int from public.tenant_memberships) memberships`
    );
    const email = '  First.Admin@Example.Test  ';
    const passwordHash = await bcrypt.hash('disposable-password-only', 12);
    const fullName = 'First Platform Admin';
    const approvalReference = 'A3-OWNER-APPROVAL-TEST-001';

    await expect(
      provisioner.query(bootstrap, ['', passwordHash, fullName, approvalReference])
    ).rejects.toMatchObject({ code: '22023' });
    const afterInvalid = await admin.query<{ users: number; owners: number; tenants: number; memberships: number }>(
      `select
         (select count(*)::int from public.users) users,
         (select count(*)::int from public.platform_owners) owners,
         (select count(*)::int from public.tenants) tenants,
         (select count(*)::int from public.tenant_memberships) memberships`
    );
    expect(afterInvalid.rows).toEqual(before.rows);

    const results = await Promise.allSettled([
      provisioner.query<ProvisionedUser>(bootstrap, [email, passwordHash, fullName, approvalReference]),
      provisioner.query<ProvisionedUser>(bootstrap, [email, passwordHash, fullName, approvalReference]),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<QueryResult<ProvisionedUser>> =>
        result.status === 'fulfilled'
    );
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0].value.rows[0]?.email).toBe('first.admin@example.test');

    const created = await admin.query<{
      email: string;
      full_name: string;
      tenant_id: string;
      tenant_type: string;
      role: string;
      email_confirmed: boolean;
      requires_manual_review: boolean;
      password_hash: string;
      memberships: number;
      membership_role: string;
    }>(
      `select u.email, u.full_name, u.tenant_id, t.tenant_type, u.role, u.email_confirmed,
              po.requires_manual_review, u.password_hash,
              (select count(*)::int from public.tenant_memberships m where m.user_id=u.id) memberships,
              (select min(m.role) from public.tenant_memberships m where m.user_id=u.id) membership_role
         from public.users u
         join public.platform_owners po on po.user_id=u.id
         join public.tenants t on t.id=u.tenant_id
        where u.email='first.admin@example.test'`
    );
    expect(created.rows).toHaveLength(1);
    const createdUser = created.rows[0];
    expect(createdUser).toMatchObject({
      email: 'first.admin@example.test',
      full_name: fullName,
      tenant_type: 'home',
      role: 'member',
      email_confirmed: true,
      requires_manual_review: false,
      password_hash: passwordHash,
      memberships: 1,
      membership_role: 'member',
    });
    expect(createdUser?.tenant_id).toMatch(/^[0-9a-f-]{36}$/i);

    const claim = await admin.query<{
      user_id: string;
      email: string;
      operator_role: string;
      approval_reference: string;
    }>(
      `select user_id, email, operator_role, approval_reference
         from public.first_platform_admin_bootstrap_claim`
    );
    expect(claim.rows).toHaveLength(1);
    expect(claim.rows[0]).toMatchObject({
      email: 'first.admin@example.test',
      operator_role: 'cocinacore_first_admin_provisioner',
      approval_reference: approvalReference,
    });
    expect(claim.rows[0]?.user_id).toMatch(/^[0-9a-f-]{36}$/i);

    const identity = await admin.query<{ id: string; tenant_id: string; email: string; full_name: string }>(
      `select id, tenant_id, email, full_name from public.users where email='first.admin@example.test'`
    );
    const adminUser = identity.rows[0];
    expect(adminUser).toBeDefined();
    expect(
      await findPlatformOwnerForSession({
        id: adminUser!.id,
        tenant: {
          tenantId: adminUser!.tenant_id,
          role: 'member',
          tenantType: 'home',
          onboardingCompleted: false,
        },
        email: adminUser!.email,
        fullName: adminUser!.full_name,
        termsAcceptedAt: null,
        termsVersion: null,
        onboardingCompleted: false,
      })
    ).toEqual({ user_id: adminUser!.id });

    const regularPasswordHash = await bcrypt.hash('disposable-regular-user', 12);
    const regularResult = await auth.query<{ user_id: string; tenant_id: string }>(
      `select user_id, tenant_id
         from public.signup_new_account($1, $2, $3, now(), 'v1')`,
      ['regular.user@example.test', regularPasswordHash, 'Regular User']
    );
    const regularUser = regularResult.rows[0];
    expect(regularUser).toBeDefined();
    expect(
      await findPlatformOwnerForSession({
        id: regularUser!.user_id,
        tenant: {
          tenantId: regularUser!.tenant_id,
          role: 'owner',
          tenantType: 'home',
          onboardingCompleted: false,
        },
        email: 'regular.user@example.test',
        fullName: 'Regular User',
        termsAcceptedAt: new Date().toISOString(),
        termsVersion: 'v1',
        onboardingCompleted: false,
      })
    ).toBeNull();

    for (const pool of [auth, runtime]) {
      await expect(
        pool.query(bootstrap, ['other@example.test', passwordHash, 'Other Admin', approvalReference])
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      provisioner.query('insert into public.platform_owners(user_id) values(gen_random_uuid())')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      provisioner.query('select user_id from public.platform_owners')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      provisioner.query('select user_id from public.first_platform_admin_bootstrap_claim')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      provisioner.query(
        `insert into public.first_platform_admin_bootstrap_claim(user_id,email,operator_role,approval_reference)
         values(gen_random_uuid(),'operator@example.test',current_user,'A3-DIRECT-ATTEMPT')`
      )
    ).rejects.toMatchObject({ code: '42501' });

    const acl = await admin.query<{
      public_execute: boolean;
      auth_execute: boolean;
      runtime_execute: boolean;
      provisioner_execute: boolean;
      provisioner_users_insert: boolean;
      provisioner_owners_insert: boolean;
      provisioner_claim_select: boolean;
      provisioner_claim_insert: boolean;
      force_rls: number;
    }>(`
      select
        has_function_privilege('public', 'public.provision_first_platform_administrator(text,text,text,text)', 'EXECUTE') public_execute,
        has_function_privilege('cocinacore_auth', 'public.provision_first_platform_administrator(text,text,text,text)', 'EXECUTE') auth_execute,
        has_function_privilege('cocinacore_runtime_rls', 'public.provision_first_platform_administrator(text,text,text,text)', 'EXECUTE') runtime_execute,
        has_function_privilege('cocinacore_first_admin_provisioner', 'public.provision_first_platform_administrator(text,text,text,text)', 'EXECUTE') provisioner_execute,
        has_table_privilege('cocinacore_first_admin_provisioner', 'public.users', 'INSERT') provisioner_users_insert,
        has_table_privilege('cocinacore_first_admin_provisioner', 'public.platform_owners', 'INSERT') provisioner_owners_insert,
        has_table_privilege('cocinacore_first_admin_provisioner', 'public.first_platform_admin_bootstrap_claim', 'SELECT') provisioner_claim_select,
        has_table_privilege('cocinacore_first_admin_provisioner', 'public.first_platform_admin_bootstrap_claim', 'INSERT') provisioner_claim_insert,
        (select count(*)::int from pg_class where oid=any(array['public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,'public.platform_owners'::regclass,'public.first_platform_admin_bootstrap_claim'::regclass]) and relrowsecurity and relforcerowsecurity) force_rls
    `);
    expect(acl.rows[0]).toEqual({
      public_execute: false,
      auth_execute: false,
      runtime_execute: false,
      provisioner_execute: true,
      provisioner_users_insert: false,
      provisioner_owners_insert: false,
      provisioner_claim_select: false,
      provisioner_claim_insert: false,
      force_rls: 5,
    });

    const after = await admin.query<{ users: number; owners: number; tenants: number; memberships: number }>(
      `select
         (select count(*)::int from public.users) users,
         (select count(*)::int from public.platform_owners) owners,
         (select count(*)::int from public.tenants) tenants,
         (select count(*)::int from public.tenant_memberships) memberships`
    );
    expect(after.rows[0]?.users).toBe((before.rows[0]?.users ?? 0) + 2);
    expect(after.rows[0]?.owners).toBe((before.rows[0]?.owners ?? 0) + 1);
    expect(after.rows[0]?.tenants).toBe((before.rows[0]?.tenants ?? 0) + 2);
    expect(after.rows[0]?.memberships).toBe((before.rows[0]?.memberships ?? 0) + 2);
    const concurrencyFailure: unknown = rejected[0]?.reason;
    if (!(concurrencyFailure instanceof Error)) throw new Error('Concurrent retry did not return an Error.');
    expect(concurrencyFailure.message).toContain('FIRST_PLATFORM_ADMIN_ALREADY_EXISTS');

    await admin.query('delete from public.users where id=$1', [adminUser!.id]);
    const retainedClaim = await admin.query<{ user_id: string; approval_reference: string }>(
      'select user_id, approval_reference from public.first_platform_admin_bootstrap_claim'
    );
    expect(retainedClaim.rows).toEqual([
      { user_id: adminUser!.id, approval_reference: approvalReference },
    ]);
    const countsAfterDeletion = await admin.query<{ users: number; owners: number; claims: number }>(
      `select (select count(*)::int from public.users) users,
              (select count(*)::int from public.platform_owners) owners,
              (select count(*)::int from public.first_platform_admin_bootstrap_claim) claims`
    );
    expect(countsAfterDeletion.rows[0]?.owners).toBe(0);
    expect(countsAfterDeletion.rows[0]?.claims).toBe(1);
    const retryFailure: unknown = await provisioner
      .query(bootstrap, [
        'second.admin@example.test',
        passwordHash,
        'Second Admin',
        'A3-OWNER-APPROVAL-TEST-002',
      ])
      .then(() => undefined, (error: unknown) => error);
    if (!(retryFailure instanceof Error)) throw new Error('Permanent claim retry was not rejected.');
    expect('code' in retryFailure ? retryFailure.code : undefined).toBe('P0001');
    expect(retryFailure.message).toContain('FIRST_PLATFORM_ADMIN_ALREADY_EXISTS');
    const countsAfterRetry = await admin.query<{ users: number; owners: number; claims: number }>(
      `select (select count(*)::int from public.users) users,
              (select count(*)::int from public.platform_owners) owners,
              (select count(*)::int from public.first_platform_admin_bootstrap_claim) claims`
    );
    expect(countsAfterRetry.rows).toEqual(countsAfterDeletion.rows);
  });
});
