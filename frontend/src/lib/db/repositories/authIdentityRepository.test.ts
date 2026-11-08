import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

const mocks = vi.hoisted(() => ({
  authQuery: vi.fn(),
  scopedTransaction: vi.fn(),
  query: vi.fn(),
  map: vi.fn((r: { rows: unknown[] }) => r.rows[0] ?? null),
}));
vi.mock('@/lib/db', () => ({
  authQuery: mocks.authQuery,
  scopedTransaction: mocks.scopedTransaction,
  query: mocks.query,
  mapSingleRow: mocks.map,
  transaction: vi.fn(),
}));
const { findUserById, findUserByIdForAuth } = await import('./userRepository');
const { findTenantById, findTenantByIdForAuth } = await import('./tenantRepository');

describe('auth identity lookups', () => {
  it('uses authQuery and forwards cancellation without changing generic consumers', async () => {
    mocks.authQuery.mockResolvedValue({ rows: [{ id: 'value' }] });
    mocks.query.mockResolvedValue({ rows: [{ id: 'value' }] });
    const options = { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 };
    await findUserByIdForAuth('user-1', options);
    await findTenantByIdForAuth('tenant-1', options);
    expect(mocks.authQuery).toHaveBeenNthCalledWith(
      1,
      'select * from public.users where id = $1',
      ['user-1'],
      options
    );
    expect(mocks.authQuery).toHaveBeenNthCalledWith(
      2,
      'select * from public.tenants where id = $1',
      ['tenant-1'],
      options
    );
    await findUserById('user-1', options);
    await findTenantById('tenant-1', options);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it('uses the caller transaction client rather than another pool', async () => {
    vi.clearAllMocks();
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    await findUserByIdForAuth('user-1', undefined, client);
    await findTenantByIdForAuth('tenant-1', undefined, client);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(mocks.authQuery).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('scopes tenant reads, forwards options, and rejects tenant mismatch', async () => {
    vi.clearAllMocks();
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'tenant-1' }] }) };
    mocks.scopedTransaction.mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
        callback(client)
    );
    const scope = { tenantId: 'tenant-1', userId: 'user-1' };
    const options = { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 };
    await expect(findTenantById('tenant-1', options, undefined, scope)).resolves.toEqual({
      id: 'tenant-1',
    });
    expect(mocks.scopedTransaction).toHaveBeenCalledWith(scope, expect.any(Function), options);
    expect(client.query).toHaveBeenCalledWith('select * from public.tenants where id = $1', [
      'tenant-1',
    ]);
    expect(mocks.query).not.toHaveBeenCalled();
    await expect(findTenantById('other', options, undefined, scope)).rejects.toThrow(
      'Tenant scope mismatch'
    );
    expect(mocks.scopedTransaction).toHaveBeenCalledOnce();
  });
});
