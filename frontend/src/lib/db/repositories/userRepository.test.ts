import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { UserRow } from '@/lib/db/types';
import type { DataUserRow, UserProfileUpdateRow, UserUpdateQueryClient } from './userRepository';

const { queryMock, authQueryMock, mapSingleRowMock, transactionMock, scopedTransactionMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult<DataUserRow>>>(),
    authQueryMock: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult<UserRow>>>(),
    mapSingleRowMock: vi.fn(),
    transactionMock: vi.fn(),
    scopedTransactionMock: vi.fn(),
  }));
const clientQueryMock =
  vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: UserProfileUpdateRow[] }>>();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  authQuery: authQueryMock,
  mapSingleRow: mapSingleRowMock,
  transaction: transactionMock,
  scopedTransaction: scopedTransactionMock,
}));

import {
  createUser,
  findUserByEmail,
  findUserByEmailForAuth,
  findUserById,
  listUsersByTenant,
  updatePassword,
  updateUserInTransaction,
} from './userRepository';

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

const user: UserRow = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'owner@example.com',
  password_hash: 'hash',
  email_confirmed: true,
  full_name: 'Owner',
  tenant_id: '00000000-0000-0000-0000-000000000002',
  role: 'owner',
  terms_accepted_at: '2026-08-14T00:00:00.000Z',
  terms_version: 'v1',
  onboarding_completed: false,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
};

const dataUser: DataUserRow = {
  id: user.id,
  email: user.email,
  email_confirmed: user.email_confirmed,
  full_name: user.full_name,
  tenant_id: user.tenant_id,
  role: user.role,
  terms_accepted_at: user.terms_accepted_at,
  terms_version: user.terms_version,
  onboarding_completed: user.onboarding_completed,
  created_at: user.created_at,
  updated_at: user.updated_at,
};
const profileUser: UserProfileUpdateRow = {
  id: user.id,
  full_name: user.full_name,
  onboarding_completed: user.onboarding_completed,
};
const columns =
  'id, email, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed, created_at, updated_at';

describe('userRepository canonical email SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapSingleRowMock.mockImplementation((result: { rows: UserRow[] }) => result.rows[0] ?? null);
  });

  it('updates the user through the supplied transaction client', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [profileUser] });
    const client: UserUpdateQueryClient = {
      queryUser: (sql, params) => clientQueryMock(sql, params),
    };

    const result = await updateUserInTransaction(client, user.id, {
      fullName: 'Updated',
      onboardingCompleted: true,
    });

    expect(clientQueryMock).toHaveBeenCalledWith(
      'update public.users set full_name = $1, onboarding_completed = $2, updated_at = now() where id = $3 returning id, full_name, onboarding_completed',
      ['Updated', true, user.id]
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(result).toEqual(profileUser);
    expect(result).not.toHaveProperty('password_hash');
  });

  it('canonicalizes lookup input in PostgreSQL while preserving parameterization and mapping', async () => {
    queryMock.mockResolvedValueOnce(queryResult([dataUser]));

    const result = await findUserByEmail('  Owner@Example.COM  ');

    expect(queryMock).toHaveBeenCalledWith(
      `select ${columns} from public.users where email = pg_catalog.lower(pg_catalog.btrim($1))`,
      ['  Owner@Example.COM  ']
    );
    expect(mapSingleRowMock).toHaveBeenCalledWith(queryResult([dataUser]));
    expect(result).toEqual(dataUser);
    expect(result).not.toHaveProperty('password_hash');
  });

  it('uses only the auth connection for the same canonical email lookup', async () => {
    authQueryMock.mockResolvedValueOnce(queryResult([{ ...user }]));
    const result = await findUserByEmailForAuth('  Owner@Example.COM  ');
    expect(authQueryMock).toHaveBeenCalledWith(
      'select * from public.users where email = pg_catalog.lower(pg_catalog.btrim($1))',
      ['  Owner@Example.COM  ']
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(result).toEqual(user);
  });

  it('scopes tenant lists and rejects incompatible context', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [dataUser] }) };
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
        callback(client)
    );
    const scope = { tenantId: 'tenant-1', userId: 'user-1' };
    await expect(listUsersByTenant('tenant-1', scope)).resolves.toEqual([dataUser]);
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function), {});
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('where tenant_id = $1'), [
      'tenant-1',
    ]);
    await expect(listUsersByTenant('other', scope)).rejects.toThrow('User scope mismatch');
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
  });

  it('returns only non-credential columns for generic id and tenant reads', async () => {
    queryMock.mockResolvedValue(queryResult([dataUser]));
    expect(await findUserById(user.id)).toEqual(dataUser);
    expect(await listUsersByTenant(user.tenant_id!)).toEqual([dataUser]);
    const statements = (queryMock.mock.calls as Array<[string, ...unknown[]]>).map(([sql]) => sql);
    expect(statements).toEqual([
      `select ${columns} from public.users where id = $1`,
      `select ${columns} from public.users where tenant_id = $1 order by created_at desc`,
    ]);
    for (const sql of statements) expect(sql).not.toMatch(/password_hash|select \*/i);
  });

  it('uses only the minimal projection for an empty profile update', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [profileUser] });
    const client: UserUpdateQueryClient = {
      queryUser: (sql, params) => clientQueryMock(sql, params),
    };
    expect(await updateUserInTransaction(client, user.id, {})).toEqual(profileUser);
    expect(clientQueryMock).toHaveBeenCalledWith(
      'select id, full_name, onboarding_completed from public.users where id = $1',
      [user.id]
    );
  });

  it('routes standalone password updates through auth rather than data query', async () => {
    authQueryMock.mockResolvedValueOnce(queryResult([]));
    await updatePassword(user.id, 'hash');
    expect(authQueryMock).toHaveBeenCalledWith(expect.stringContaining('set password_hash'), [
      'hash',
      user.id,
    ]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('canonicalizes inserted email in PostgreSQL without JavaScript identity normalization', async () => {
    authQueryMock.mockResolvedValueOnce(queryResult([{ ...user }]));
    const input: Parameters<typeof createUser>[0] = {
      email: '  Owner@Example.COM  ',
      passwordHash: 'hash',
      fullName: 'Owner',
      tenantId: '00000000-0000-0000-0000-000000000002',
      role: 'owner',
      termsAcceptedAt: '2026-08-14T00:00:00.000Z',
      termsVersion: 'v1',
    };

    const result = await createUser(input);

    const [sql, parameters] = authQueryMock.mock.calls[0] ?? [];
    expect(sql).toContain('values (pg_catalog.lower(pg_catalog.btrim($1)), $2');
    expect(sql).not.toContain(input.email);
    expect(parameters).toEqual([
      input.email,
      input.passwordHash,
      input.fullName,
      input.tenantId,
      input.role,
      input.termsAcceptedAt,
      input.termsVersion,
    ]);
    expect(mapSingleRowMock).toHaveBeenCalledWith(queryResult([{ ...user }]));
    expect(result).toEqual(user);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
