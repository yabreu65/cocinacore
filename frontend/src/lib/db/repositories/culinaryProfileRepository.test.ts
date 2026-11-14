import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { UserCulinaryProfileRow } from '@/lib/db/types';
import type {
  CulinaryProfileQueryClient,
  UserCulinaryProfileTermWithLabel,
} from './culinaryProfileRepository';

interface QueryCall {
  operation: 'profile' | 'terms' | 'execute';
  sql: string;
  params?: unknown[];
}

const profileQueryMock =
  vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: UserCulinaryProfileRow[] }>>();
const termsQueryMock =
  vi.fn<
    (sql: string, params?: unknown[]) => Promise<{ rows: UserCulinaryProfileTermWithLabel[] }>
  >();
const executeMock = vi.fn<(sql: string, params?: unknown[]) => Promise<void>>();
const queryCalls: QueryCall[] = [];

function recordQuery(operation: QueryCall['operation'], sql: string, params?: unknown[]): void {
  queryCalls.push({ operation, sql, params });
}
const globalQueryMock = vi.fn();
const transactionMock = vi.fn();
const scopedTransactionMock = vi.fn(
  async (
    _scope: unknown,
    callback: (client: { query: typeof globalQueryMock }) => Promise<unknown>
  ) => callback({ query: globalQueryMock })
);
const transactionEvents: string[] = [];

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

const client: CulinaryProfileQueryClient = {
  async queryProfile(sql, params) {
    recordQuery('profile', sql, params);
    return profileQueryMock(sql, params);
  },
  async queryTerms(sql, params) {
    recordQuery('terms', sql, params);
    return termsQueryMock(sql, params);
  },
  async execute(sql, params) {
    recordQuery('execute', sql, params);
    await executeMock(sql, params);
  },
};

vi.mock('@/lib/db', () => ({
  query: globalQueryMock,
  mapSingleRow: (result: { rows: unknown[] }) => result.rows[0] ?? null,
  transaction: transactionMock,
  scopedTransaction: scopedTransactionMock,
}));

const {
  findCulinaryProfileByUserAndTenant,
  findCulinaryProfileByUserId,
  findCulinaryProfileByUserIdInTransaction,
  findCulinaryProfileTermsByUserIdInTransaction,
  findCulinaryProfileTermsByUserId,
  listWastePreventionCulinaryProfileTermsByUserId,
  lockCulinaryProfileUpdateInTransaction,
  ProfileTenantMismatchError,
  saveCulinaryProfile,
  saveCulinaryProfileInTransaction,
  setCulinaryProfileTerms,
  upsertCulinaryProfile,
} = await import('./culinaryProfileRepository');

const savedProfile: UserCulinaryProfileRow = {
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  level: 'Intermedio',
  available_time_minutes: null,
  disliked_ingredients: [],
  allergies: [],
  household_members: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('transaction-scoped culinary profile reads and lock', () => {
  beforeEach(() => {
    scopedTransactionMock.mockClear();
    profileQueryMock.mockReset();
    termsQueryMock.mockReset();
    executeMock.mockReset();
    queryCalls.length = 0;
    globalQueryMock.mockReset();
  });

  it('acquires a tenant-and-user advisory transaction lock on the supplied client', async () => {
    await lockCulinaryProfileUpdateInTransaction(client, 'user-1', 'tenant-1');

    expect(queryCalls).toEqual([
      {
        operation: 'execute',
        sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        params: ['culinary-profile:tenant-1:user-1'],
      },
    ]);
    expect(globalQueryMock).not.toHaveBeenCalled();
    expect(scopedTransactionMock).not.toHaveBeenCalled();
  });

  it('reads the current profile with the supplied transaction client', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await expect(
      findCulinaryProfileByUserIdInTransaction(client, 'user-1', 'tenant-1')
    ).resolves.toEqual(savedProfile);

    expect(queryCalls).toEqual([
      {
        operation: 'profile',
        sql: 'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
        params: ['user-1', 'tenant-1'],
      },
    ]);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('reads current terms with labels using the supplied transaction client', async () => {
    const selectedTerm: UserCulinaryProfileTermWithLabel = {
      user_id: 'user-1',
      term_id: 'term-1',
      preference_type: 'avoid',
      weight: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      term_label: 'Maní',
    };
    termsQueryMock.mockResolvedValueOnce(queryResult([selectedTerm]));

    await expect(
      findCulinaryProfileTermsByUserIdInTransaction(client, 'user-1', 'tenant-1')
    ).resolves.toEqual([selectedTerm]);

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.operation).toBe('terms');
    expect(queryCalls[0]?.sql).toContain(
      'from public.user_culinary_profile_terms as profile_terms'
    );
    expect(queryCalls[0]?.params).toEqual(['user-1', 'tenant-1']);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('keeps profile query mock rows distinct from term rows', () => {
    const term: UserCulinaryProfileTermWithLabel = {
      user_id: 'user-1',
      term_id: 'term-1',
      preference_type: 'avoid',
      weight: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      term_label: 'Maní',
    };
    if (false) {
      // @ts-expect-error Profile query mocks accept profile rows only.
      profileQueryMock.mockResolvedValueOnce(queryResult([term]));
    }
  });
});

describe('tenant-scoped culinary profile reads', () => {
  beforeEach(() => {
    globalQueryMock.mockReset();
    scopedTransactionMock.mockClear();
  });

  it('includes both user and tenant in the SQL predicate', async () => {
    globalQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await expect(findCulinaryProfileByUserAndTenant('user-1', 'tenant-1')).resolves.toEqual(
      savedProfile
    );

    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function),
      {}
    );
    expect(globalQueryMock).toHaveBeenCalledWith(
      'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
      ['user-1', 'tenant-1']
    );
  });

  it('requires the tenant predicate for the primary user lookup', async () => {
    globalQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await expect(findCulinaryProfileByUserId('user-1', 'tenant-1')).resolves.toEqual(savedProfile);

    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function)
    );
    expect(globalQueryMock).toHaveBeenCalledWith(
      'select * from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
      ['user-1', 'tenant-1']
    );
  });

  it('applies both timeouts on the scoped client and forwards deadline and cancellation', async () => {
    globalQueryMock.mockResolvedValue({ rows: [] });
    const options = { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 };
    await findCulinaryProfileTermsByUserId('user-1', 'tenant-1', 300, options);
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function),
      options
    );
    expect(globalQueryMock.mock.calls).toEqual([
      ["select set_config('statement_timeout', $1, true)", ['300ms']],
      ["select set_config('lock_timeout', $1, true)", ['300ms']],
      [expect.stringContaining('from public.user_culinary_profile_terms'), ['user-1', 'tenant-1']],
    ]);
    await expect(
      findCulinaryProfileTermsByUserId('user-1', 'tenant-1', 0, options)
    ).rejects.toThrow('Statement timeout');
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
  });
});

describe('waste-prevention profile term reads', () => {
  beforeEach(() => {
    globalQueryMock.mockReset();
    scopedTransactionMock.mockClear();
  });

  it('scopes and bounds profile terms for the read-only projection', async () => {
    const terms = [
      {
        user_id: 'user-1',
        term_id: 'term-1',
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        term_label: 'Maní',
      },
    ];
    globalQueryMock.mockResolvedValueOnce(queryResult(terms));

    await expect(
      listWastePreventionCulinaryProfileTermsByUserId('user-1', 'tenant-1', 500)
    ).resolves.toEqual(terms);

    const [sql, params] = globalQueryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('where profile_terms.user_id = $1');
    expect(sql).toContain('limit $3');
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function)
    );
    expect(params).toEqual(['user-1', 'tenant-1', 101]);
  });
});

describe('legacy upsertCulinaryProfile tenant guard', () => {
  beforeEach(() => {
    globalQueryMock.mockReset();
  });

  it('rejects a tenant mismatch when the guarded upsert returns no row', async () => {
    globalQueryMock.mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([]));

    await expect(
      upsertCulinaryProfile({
        userId: 'user-1',
        tenantId: 'tenant-2',
        level: 'Chef',
      })
    ).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-2', userId: 'user-1' },
      expect.any(Function)
    );
    expect(globalQueryMock).toHaveBeenCalledTimes(2);
    expect(globalQueryMock.mock.calls[0]).toEqual([
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['culinary-profile:tenant-2:user-1'],
    ]);
    expect(globalQueryMock.mock.calls[1]?.[0]).toContain(
      'where user_culinary_profiles.tenant_id = excluded.tenant_id'
    );
    expect(globalQueryMock.mock.calls[1]?.[0]).not.toMatch(
      /set\s+tenant_id\s*=\s*excluded\.tenant_id/i
    );
  });
});

describe('saveCulinaryProfile transaction boundary', () => {
  beforeEach(() => {
    profileQueryMock.mockReset();
    termsQueryMock.mockReset();
    executeMock.mockReset();
    queryCalls.length = 0;
    globalQueryMock.mockReset();
    transactionMock.mockReset();
    scopedTransactionMock.mockClear();
    transactionEvents.length = 0;
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: unknown) => transactionMock(callback) as Promise<unknown>
    );
    transactionMock.mockImplementation(async (work: (tx: typeof client) => Promise<unknown>) => {
      transactionEvents.push('BEGIN');
      try {
        const result = await work(client);
        transactionEvents.push('COMMIT');
        return result;
      } catch (error) {
        transactionEvents.push('ROLLBACK');
        throw error;
      }
    });
  });

  it('writes through the supplied transaction client without opening a nested transaction', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfileInTransaction(client, {
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Intermedio',
    });

    expect(transactionMock).not.toHaveBeenCalled();
    expect(scopedTransactionMock).not.toHaveBeenCalled();
    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[0]).toEqual({
      operation: 'execute',
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      params: ['culinary-profile:tenant-1:user-1'],
    });
    expect(queryCalls[1]?.sql).toContain('insert into public.user_culinary_profiles');
    expect(queryCalls[1]?.sql).not.toMatch(/set\s+tenant_id\s*=\s*excluded\.tenant_id/i);
  });

  it('replaces terms only after locking a profile owned by the requested tenant', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await setCulinaryProfileTerms('user-1', 'tenant-1', [
      { termId: 'term-1', preferenceType: 'avoid' },
    ]);

    expect(queryCalls[1]?.sql).toContain('for update');
    expect(queryCalls[1]?.params).toEqual(['user-1', 'tenant-1']);
    expect(queryCalls[2]?.sql).toContain('delete from public.user_culinary_profile_terms');
    expect(queryCalls[3]?.sql).toContain('insert into public.user_culinary_profile_terms');
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });

  it('fails closed without deleting or inserting terms for a missing or foreign profile', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([]));

    await expect(
      setCulinaryProfileTerms('user-1', 'tenant-2', [{ termId: 'term-1', preferenceType: 'avoid' }])
    ).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1]?.sql).toContain('where user_id = $1 and tenant_id = $2');
    expect(executeMock).toHaveBeenCalledExactlyOnceWith(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['culinary-profile:tenant-2:user-1']
    );
    expect(transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('rejects a conflicting tenant before any profile or term write', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([]));

    await expect(
      saveCulinaryProfileInTransaction(client, {
        userId: 'user-1',
        tenantId: 'tenant-2',
        level: 'Chef',
        terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
      })
    ).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1]?.sql).toContain(
      'where user_culinary_profiles.tenant_id = excluded.tenant_id'
    );
    expect(queryCalls[1]?.sql).not.toMatch(/set\s+tenant_id\s*=\s*excluded\.tenant_id/i);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('preserves the tenant mismatch domain error for an RLS-rejected profile transfer', async () => {
    const error = Object.assign(
      new Error('new row violates row-level security policy for table "user_culinary_profiles"'),
      { code: '42501' }
    );
    profileQueryMock.mockRejectedValueOnce(error);

    await expect(
      saveCulinaryProfileInTransaction(client, {
        userId: 'user-1',
        tenantId: 'tenant-2',
        level: 'Chef',
      })
    ).rejects.toBeInstanceOf(ProfileTenantMismatchError);
    expect(queryCalls).toHaveLength(2);
  });

  it('writes the profile and replacement terms on one transaction client', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfile({
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Intermedio',
      terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function)
    );
    expect(queryCalls).toHaveLength(4);
    expect(queryCalls[1]?.params).toEqual([
      'user-1',
      'tenant-1',
      'Intermedio',
      null,
      [],
      [],
      '[]',
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(queryCalls[2]?.sql).toContain('delete from public.user_culinary_profile_terms');
    expect(queryCalls[2]?.params).toEqual(['user-1', 'tenant-1']);
    expect(queryCalls[3]?.sql).toContain('insert into public.user_culinary_profile_terms');
    expect(queryCalls[3]?.params).toEqual(['user-1', 'term-1', 'avoid', 1]);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });

  it('writes every profile field with term replacement in the same transaction', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfile({
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Chef',
      availableTimeMinutes: 45,
      dislikedIngredients: ['cilantro'],
      allergies: ['maní'],
      householdMembers: [{ name: 'Ana', ageGroup: 'adult' }],
      terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
    });

    expect(queryCalls[1]?.sql).toContain('available_time_minutes');
    expect(queryCalls[1]?.sql).toContain('disliked_ingredients');
    expect(queryCalls[1]?.params).toEqual([
      'user-1',
      'tenant-1',
      'Chef',
      45,
      ['cilantro'],
      ['maní'],
      JSON.stringify([{ name: 'Ana', ageGroup: 'adult' }]),
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back profile and term replacement when a term insert fails', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));
    executeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('term constraint failed'));

    await expect(
      saveCulinaryProfile({
        userId: 'user-1',
        tenantId: 'tenant-1',
        level: 'Chef',
        terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
      })
    ).rejects.toThrow('term constraint failed');

    expect(transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
    expect(queryCalls[1]?.params).toEqual([
      'user-1',
      'tenant-1',
      'Chef',
      null,
      [],
      [],
      '[]',
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('preserves the profile value and does not delete selections when the caller omits them', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfile({ userId: 'user-1', tenantId: 'tenant-1', level: 'Intermedio' });

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1]?.sql).toContain('on conflict (user_id) do update');
    expect(queryCalls[1]?.params).toEqual([
      'user-1',
      'tenant-1',
      'Intermedio',
      null,
      [],
      [],
      '[]',
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(
      queryCalls.some(({ sql }) => sql.includes('delete from public.user_culinary_profile_terms'))
    ).toBe(false);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });

  it('clears only the selected term list when replacement selections are explicitly empty', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfile({
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Intermedio',
      terms: [],
    });

    expect(queryCalls).toHaveLength(3);
    expect(queryCalls[2]?.sql).toContain('delete from public.user_culinary_profile_terms');
    expect(queryCalls[2]?.params).toEqual(['user-1', 'tenant-1']);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });
});
