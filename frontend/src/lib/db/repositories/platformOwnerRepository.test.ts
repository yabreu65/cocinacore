import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

type ScopedTransactionMock = (
  scope: { tenantId: string; userId: string },
  callback: (client: PoolClient) => unknown
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  scopedTransaction: vi.fn<ScopedTransactionMock>(),
  query: vi.fn(),
}));
vi.mock('@/lib/db', () => mocks);

import { findPlatformOwnerForSession, isPlatformOwner } from './platformOwnerRepository';

const owner = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  fullName: 'Owner',
  tenant: {
    tenantId: '00000000-0000-4000-8000-000000000002',
    role: 'owner' as const,
    tenantType: 'home' as const,
    onboardingCompleted: true,
  },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: true,
};

describe('platform owner identity capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ user_id: owner.id }] }),
    } as unknown as PoolClient;
    mocks.scopedTransaction.mockImplementation(async (_scope, callback) => callback(client));
  });

  it('checks only the authenticated session user inside its tenant scope', async () => {
    expect(await findPlatformOwnerForSession(owner)).toEqual({ user_id: owner.id });
    expect(mocks.scopedTransaction).toHaveBeenCalledOnce();
    expect(mocks.scopedTransaction.mock.calls[0][0]).toEqual({
      tenantId: owner.tenant.tenantId,
      userId: owner.id,
    });
    expect(mocks.scopedTransaction.mock.calls[0][1]).toBeTypeOf('function');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('denies a session without tenant context without opening a database connection', async () => {
    expect(await isPlatformOwner({ ...owner, tenant: null })).toBe(false);
    expect(mocks.scopedTransaction).not.toHaveBeenCalled();
  });

  it('returns false when the scoped lookup cannot see an owner row', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as PoolClient;
    mocks.scopedTransaction.mockImplementationOnce(async (_scope, callback) => callback(client));
    expect(await isPlatformOwner(owner)).toBe(false);
  });
});
