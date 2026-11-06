import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { scopedTransaction } from '@/lib/db';

const enabled = process.env.COCINACORE_TENANT_INVITATIONS_RLS_TEST === '1';
let admin: Pool;
let runtime: Pool;
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA1 = randomUUID();
const userA2 = randomUUID();
const userB1 = randomUUID();
const invitationA = randomUUID();
const invitationB = randomUUID();

describe.skipIf(!enabled)('020D5 tenant invitation read boundary on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const adminUrl = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const runtimeUrl = new URL(process.env.DATABASE_URL ?? '');
    if (
      adminUrl.hostname !== '127.0.0.1' ||
      adminUrl.pathname !== '/signup_real_disposable' ||
      runtimeUrl.host !== adminUrl.host ||
      runtimeUrl.pathname !== adminUrl.pathname ||
      runtimeUrl.username !== 'cocinacore_runtime_rls'
    ) {
      throw new Error('020D5 requires the isolated loopback PostgreSQL fixture');
    }

    admin = new Pool({ connectionString: adminUrl.toString() });
    runtime = new Pool({ connectionString: runtimeUrl.toString() });
    const marker = await admin.query<{ marker: string | null }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0]?.marker !== 'cocinacore-signup-real-disposable') {
      throw new Error('Disposable database marker required');
    }

    await admin.query('insert into public.tenants(id,name) values ($1,$2),($3,$4)', [
      tenantA,
      '020D5 Tenant A',
      tenantB,
      '020D5 Tenant B',
    ]);
    await admin.query(
      `insert into public.users(id,email,password_hash,tenant_id,role) values
        ($1,'020d5-a1@example.test','fixture',$4,'owner'),
        ($2,'020d5-a2@example.test','fixture',$4,'owner'),
        ($3,'020d5-b1@example.test','fixture',$5,'owner')`,
      [userA1, userA2, userB1, tenantA, tenantB]
    );
    await admin.query(
      "insert into public.tenant_memberships(tenant_id,user_id,role) values ($1,$3,'owner'),($1,$4,'owner'),($2,$5,'owner')",
      [tenantA, tenantB, userA1, userA2, userB1]
    );
    await admin.query(
      `insert into public.tenant_invitations(id,tenant_id,email,invited_by,invitation_token,expires_at) values
        ($1,$3,'invite-a@example.test',$5,'020d5-secret-a',now()+interval '1 day'),
        ($2,$4,'invite-b@example.test',$6,'020d5-secret-b',now()+interval '1 day')`,
      [invitationA, invitationB, tenantA, tenantB, userA1, userB1]
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query('delete from public.tenants where id = any($1::uuid[])', [
        [tenantA, tenantB],
      ]);
    }
    await Promise.all([runtime?.end(), admin?.end()]);
  });

  it('returns only current-tenant summaries to every member and denies absent or mismatched context', async () => {
    const absent = await runtime.query('select id,email,status from public.tenant_invitations');
    expect(absent.rows).toEqual([]);

    const firstMember = await scopedTransaction({ tenantId: tenantA, userId: userA1 }, (client) =>
      client.query<{ id: string; email: string }>(
        'select id,email from public.tenant_invitations order by email'
      )
    );
    expect(firstMember.rows).toEqual([{ id: invitationA, email: 'invite-a@example.test' }]);

    const secondMember = await scopedTransaction({ tenantId: tenantA, userId: userA2 }, (client) =>
      client.query<{ id: string; email: string }>(
        'select id,email from public.tenant_invitations order by email'
      )
    );
    expect(secondMember.rows).toEqual(firstMember.rows);

    const otherTenant = await scopedTransaction({ tenantId: tenantB, userId: userB1 }, (client) =>
      client.query<{ id: string; email: string }>(
        'select id,email from public.tenant_invitations order by email'
      )
    );
    expect(otherTenant.rows).toEqual([{ id: invitationB, email: 'invite-b@example.test' }]);

    const mismatched = await scopedTransaction({ tenantId: tenantA, userId: userB1 }, (client) =>
      client.query('select id,email from public.tenant_invitations')
    );
    expect(mismatched.rows).toEqual([]);
  });

  it('exposes only summary columns and grants no runtime invitation writes', async () => {
    for (const column of ['invitation_token', 'invited_by', 'accepted_by', 'accepted_at', 'role']) {
      await expect(
        runtime.query(`select ${column} from public.tenant_invitations`)
      ).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(
      runtime.query(
        `insert into public.tenant_invitations(tenant_id,email,invited_by,invitation_token,expires_at)
         values ($1,'write@example.test',$2,'020d5-write',now()+interval '1 day')`,
        [tenantA, userA1]
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query("update public.tenant_invitations set status='revoked' where id=$1", [
        invitationA,
      ])
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query('delete from public.tenant_invitations where id=$1', [invitationA])
    ).rejects.toMatchObject({
      code: '42501',
    });

    const privileges = await admin.query<{
      invitation_token: boolean;
      summary_select: boolean;
      table_select: boolean;
      insert: boolean;
      update: boolean;
      delete: boolean;
      force_rls: boolean;
    }>(
      `select has_column_privilege('cocinacore_runtime_rls','public.tenant_invitations','invitation_token','SELECT') invitation_token,
         has_column_privilege('cocinacore_runtime_rls','public.tenant_invitations','email','SELECT') summary_select,
         has_table_privilege('cocinacore_runtime_rls','public.tenant_invitations','SELECT') table_select,
         has_table_privilege('cocinacore_runtime_rls','public.tenant_invitations','INSERT') insert,
         has_table_privilege('cocinacore_runtime_rls','public.tenant_invitations','UPDATE') update,
         has_table_privilege('cocinacore_runtime_rls','public.tenant_invitations','DELETE') delete,
         (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.tenant_invitations'::regclass) force_rls`
    );
    expect(privileges.rows[0]).toEqual({
      invitation_token: false,
      summary_select: true,
      table_select: false,
      insert: false,
      update: false,
      delete: false,
      force_rls: true,
    });
  });
});
