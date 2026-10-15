import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { UserRow } from '@/lib/db/types';
import type { UserUpdateQueryClient } from './userRepository';

const { queryMock, mapSingleRowMock, transactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult<UserRow>>>(),
  mapSingleRowMock: vi.fn(),
  transactionMock: vi.fn(),
}));
const clientQueryMock = vi.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }>
>();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
  transaction: transactionMock,
}));

import { createUser, findUserByEmail, updateUserInTransaction } from './userRepository';

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

describe('userRepository canonical email SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapSingleRowMock.mockImplementation((result: { rows: UserRow[] }) => result.rows[0] ?? null);
  });

  it('updates the user through the supplied transaction client', async () => {
    clientQueryMock.mockResolvedValueOnce(queryResult([{ ...user }]));
    const client: UserUpdateQueryClient = {
      queryUser: (sql, params) => clientQueryMock(sql, params),
    };

    const result = await updateUserInTransaction(client, user.id, {
      fullName: 'Updated',
      onboardingCompleted: true,
    });

    expect(clientQueryMock).toHaveBeenCalledWith(
      'update public.users set full_name = $1, onboarding_completed = $2, updated_at = now() where id = $3 returning *',
      ['Updated', true, user.id]
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(result).toEqual(user);
  });

  it('canonicalizes lookup input in PostgreSQL while preserving parameterization and mapping', async () => {
    queryMock.mockResolvedValueOnce(queryResult([{ ...user }]));

    const result = await findUserByEmail('  Owner@Example.COM  ');

    expect(queryMock).toHaveBeenCalledWith(
      'select * from public.users where email = pg_catalog.lower(pg_catalog.btrim($1))',
      ['  Owner@Example.COM  ']
    );
    expect(mapSingleRowMock).toHaveBeenCalledWith(queryResult([{ ...user }]));
    expect(result).toEqual(user);
  });

  it('canonicalizes inserted email in PostgreSQL without JavaScript identity normalization', async () => {
    queryMock.mockResolvedValueOnce(queryResult([{ ...user }]));
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

    const [sql, parameters] = queryMock.mock.calls[0] ?? [];
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
  });
});
