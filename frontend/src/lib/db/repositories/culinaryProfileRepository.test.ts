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

const profileQueryMock = vi.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: UserCulinaryProfileRow[] }>
>();
const termsQueryMock = vi.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: UserCulinaryProfileTermWithLabel[] }>
>();
const executeMock = vi.fn<(sql: string, params?: unknown[]) => Promise<void>>();
const queryCalls: QueryCall[] = [];

function recordQuery(operation: QueryCall['operation'], sql: string, params?: unknown[]): void {
  queryCalls.push({ operation, sql, params });
}
const globalQueryMock = vi.fn();
const transactionMock = vi.fn();
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
}));

const {
  findCulinaryProfileByUserIdInTransaction,
  findCulinaryProfileTermsByUserIdInTransaction,
  listWastePreventionCulinaryProfileTermsByUserId,
  lockCulinaryProfileUpdateInTransaction,
  ProfileTenantMismatchError,
  saveCulinaryProfile,
  saveCulinaryProfileInTransaction,
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
    profileQueryMock.mockReset();
    termsQueryMock.mockReset();
    executeMock.mockReset();
    queryCalls.length = 0;
    globalQueryMock.mockReset();
  });

  it('acquires a stable user-only advisory transaction lock on the supplied client', async () => {
    await lockCulinaryProfileUpdateInTransaction(client, 'user-1');

    expect(queryCalls).toEqual([{
      operation: 'execute',
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      params: ['culinary-profile:user-1'],
    }]);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('reads the current profile with the supplied transaction client', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await expect(findCulinaryProfileByUserIdInTransaction(client, 'user-1'))
      .resolves.toEqual(savedProfile);

    expect(queryCalls).toEqual([{
      operation: 'profile',
      sql: 'select * from public.user_culinary_profiles where user_id = $1',
      params: ['user-1'],
    }]);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('reads current terms with labels using the supplied transaction client', async () => {
    const selectedTerm: UserCulinaryProfileTermWithLabel = {
      user_id: 'user-1', term_id: 'term-1', preference_type: 'avoid', weight: 1,
      created_at: '2026-01-01T00:00:00.000Z', term_label: 'Maní',
    };
    termsQueryMock.mockResolvedValueOnce(queryResult([selectedTerm]));

    await expect(findCulinaryProfileTermsByUserIdInTransaction(client, 'user-1'))
      .resolves.toEqual([selectedTerm]);

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.operation).toBe('terms');
    expect(queryCalls[0]?.sql).toContain('from public.user_culinary_profile_terms as profile_terms');
    expect(queryCalls[0]?.params).toEqual(['user-1']);
    expect(globalQueryMock).not.toHaveBeenCalled();
  });

  it('keeps profile query mock rows distinct from term rows', () => {
    const term: UserCulinaryProfileTermWithLabel = {
      user_id: 'user-1', term_id: 'term-1', preference_type: 'avoid', weight: 1,
      created_at: '2026-01-01T00:00:00.000Z', term_label: 'Maní',
    };
    if (false) {
      // @ts-expect-error Profile query mocks accept profile rows only.
      profileQueryMock.mockResolvedValueOnce(queryResult([term]));
    }
  });
});

describe('waste-prevention profile term reads', () => {
  beforeEach(() => globalQueryMock.mockReset());

  it('scopes and bounds profile terms for the read-only projection', async () => {
    const terms = [{
      user_id: 'user-1', term_id: 'term-1', preference_type: 'avoid', weight: 1,
      created_at: '2026-01-01T00:00:00.000Z', term_label: 'Maní',
    }];
    globalQueryMock.mockResolvedValueOnce(queryResult(terms));

    await expect(listWastePreventionCulinaryProfileTermsByUserId('user-1', 500))
      .resolves.toEqual(terms);

    const [sql, params] = globalQueryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('where profile_terms.user_id = $1');
    expect(sql).toContain('limit $2');
    expect(params).toEqual(['user-1', 101]);
  });
});

describe('legacy upsertCulinaryProfile tenant guard', () => {
  beforeEach(() => {
    globalQueryMock.mockReset();
  });

  it('rejects a tenant mismatch when the guarded upsert returns no row', async () => {
    globalQueryMock.mockResolvedValueOnce(queryResult([]));

    await expect(upsertCulinaryProfile({
      userId: 'user-1',
      tenantId: 'tenant-2',
      level: 'Chef',
    })).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    expect(globalQueryMock).toHaveBeenCalledTimes(1);
    expect(globalQueryMock.mock.calls[0]?.[0]).toContain(
      'where user_culinary_profiles.tenant_id = excluded.tenant_id'
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
    transactionEvents.length = 0;
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
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.sql).toContain('insert into public.user_culinary_profiles');
  });

  it('rejects a conflicting tenant before any profile or term write', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([]));

    await expect(saveCulinaryProfileInTransaction(client, {
      userId: 'user-1',
      tenantId: 'tenant-2',
      level: 'Chef',
      terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
    })).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.sql).toContain('where user_culinary_profiles.tenant_id = excluded.tenant_id');
    expect(globalQueryMock).not.toHaveBeenCalled();
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
    expect(queryCalls).toHaveLength(3);
    expect(queryCalls[0]?.params).toEqual([
      'user-1', 'tenant-1', 'Intermedio', null, [], [], '[]', true, false, false, false, false,
    ]);
    expect(queryCalls[1]?.sql).toContain('delete from public.user_culinary_profile_terms');
    expect(queryCalls[1]?.params).toEqual(['user-1']);
    expect(queryCalls[2]?.sql).toContain('insert into public.user_culinary_profile_terms');
    expect(queryCalls[2]?.params).toEqual(['user-1', 'term-1', 'avoid', 1]);
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

    expect(queryCalls[0]?.sql).toContain('available_time_minutes');
    expect(queryCalls[0]?.sql).toContain('disliked_ingredients');
    expect(queryCalls[0]?.params).toEqual([
      'user-1', 'tenant-1', 'Chef', 45, ['cilantro'], ['maní'],
      JSON.stringify([{ name: 'Ana', ageGroup: 'adult' }]), true, true, true, true, true,
    ]);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back profile and term replacement when a term insert fails', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));
    executeMock.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('term constraint failed'));

    await expect(saveCulinaryProfile({
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Chef',
      terms: [{ termId: 'term-1', preferenceType: 'avoid' }],
    })).rejects.toThrow('term constraint failed');

    expect(transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
    expect(queryCalls[0]?.params).toEqual([
      'user-1', 'tenant-1', 'Chef', null, [], [], '[]', true, false, false, false, false,
    ]);
  });

  it('preserves the profile value and does not delete selections when the caller omits them', async () => {
    profileQueryMock.mockResolvedValueOnce(queryResult([{ ...savedProfile }]));

    await saveCulinaryProfile({ userId: 'user-1', tenantId: 'tenant-1', level: 'Intermedio' });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.sql).toContain('on conflict (user_id) do update');
    expect(queryCalls[0]?.params).toEqual([
      'user-1', 'tenant-1', 'Intermedio', null, [], [], '[]', true, false, false, false, false,
    ]);
    expect(queryCalls.some(({ sql }) => sql.includes('delete from public.user_culinary_profile_terms'))).toBe(false);
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

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1]?.sql).toContain('delete from public.user_culinary_profile_terms');
    expect(queryCalls[1]?.params).toEqual(['user-1']);
    expect(transactionEvents).toEqual(['BEGIN', 'COMMIT']);
  });
});
