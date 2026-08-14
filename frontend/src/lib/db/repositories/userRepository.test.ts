import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRow } from '@/lib/db/types';

const { queryMock, mapSingleRowMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mapSingleRowMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
}));

import { createUser, findUserByEmail } from './userRepository';

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

  it('canonicalizes lookup input in PostgreSQL while preserving parameterization and mapping', async () => {
    queryMock.mockResolvedValueOnce({ rows: [user] });

    const result = await findUserByEmail('  Owner@Example.COM  ');

    expect(queryMock).toHaveBeenCalledWith(
      'select * from public.users where email = pg_catalog.lower(pg_catalog.btrim($1))',
      ['  Owner@Example.COM  ']
    );
    expect(mapSingleRowMock).toHaveBeenCalledWith({ rows: [user] });
    expect(result).toEqual(user);
  });

  it('canonicalizes inserted email in PostgreSQL without JavaScript identity normalization', async () => {
    queryMock.mockResolvedValueOnce({ rows: [user] });
    const input = {
      email: '  Owner@Example.COM  ',
      passwordHash: 'hash',
      fullName: 'Owner',
      tenantId: '00000000-0000-0000-0000-000000000002',
      role: 'owner' as const,
      termsAcceptedAt: '2026-08-14T00:00:00.000Z',
      termsVersion: 'v1',
    };

    const result = await createUser(input);

    const [sql, parameters] = queryMock.mock.calls[0] as [string, unknown[]];
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
    expect(mapSingleRowMock).toHaveBeenCalledWith({ rows: [user] });
    expect(result).toEqual(user);
  });
});
