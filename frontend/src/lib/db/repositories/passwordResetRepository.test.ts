import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

const mocks = vi.hoisted(() => ({
  authQuery: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  authTransaction: vi.fn(),
  mapSingleRow: vi.fn((result: { rows: unknown[] }) => result.rows[0] ?? null),
}));
vi.mock('@/lib/db', () => mocks);
const repo = await import('./passwordResetRepository');

const token = {
  id: 'reset-1',
  user_id: 'user-1',
  token_hash: 'hash',
  requested_ip_hash: null,
  expires_at: '2026-11-05T00:00:00Z',
  used_at: null,
  created_at: '2026-11-04T00:00:00Z',
};

describe('password reset auth SQL', () => {
  const clientQuery = vi.fn();
  const client = { query: clientQuery };

  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery.mockReset().mockResolvedValue({ rows: [token] });
    mocks.authQuery.mockReset().mockResolvedValue({ rows: [token] });
    mocks.authTransaction
      .mockReset()
      .mockImplementation(
        async (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
          callback(client)
      );
  });

  it('invalidates old tokens and inserts the new hash on one auth transaction client', async () => {
    const expiresAt = new Date('2026-11-05T00:00:00Z');
    await expect(
      repo.createPasswordResetToken({
        userId: 'user-1',
        tokenHash: 'hash',
        requestedIpHash: null,
        expiresAt,
      })
    ).resolves.toEqual(token);
    expect(mocks.authTransaction).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls).toEqual([
      [expect.stringContaining('set used_at = now()'), ['user-1']],
      [
        expect.stringContaining('insert into public.password_reset_tokens'),
        ['user-1', 'hash', null, expiresAt.toISOString()],
      ],
    ]);
    expect(mocks.authQuery).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('locks a valid token, runs the callback on the same client and marks it used', async () => {
    const callback = vi.fn(async (tx: PoolClient) => {
      await tx.query('update password and revoke sessions');
      return true;
    });
    await expect(repo.consumePasswordResetToken('hash', callback)).resolves.toBe(true);
    expect(mocks.authTransaction).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(client, token);
    expect(clientQuery.mock.calls[0][0]).toContain('for update');
    expect(clientQuery.mock.calls[0][0]).toContain('used_at is null');
    expect(clientQuery.mock.calls[0][0]).toContain('expires_at > now()');
    expect(clientQuery.mock.calls[1][0]).toBe('update password and revoke sessions');
    expect(clientQuery.mock.calls[2]).toEqual([
      'update public.password_reset_tokens set used_at = now() where id = $1',
      ['reset-1'],
    ]);
    expect(mocks.authQuery).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'expired', 'used'] as const)(
    'does not invoke callback for %s token',
    async () => {
      clientQuery.mockResolvedValueOnce({ rows: [] });
      const callback = vi.fn();
      await expect(repo.consumePasswordResetToken('hash', callback)).resolves.toBeNull();
      expect(callback).not.toHaveBeenCalled();
      expect(clientQuery).toHaveBeenCalledOnce();
    }
  );

  it.each(['invalidate', 'insert', 'callback', 'mark'] as const)(
    'propagates %s errors to the transaction',
    async (stage) => {
      const failure = new Error('injected');
      if (stage === 'invalidate') clientQuery.mockRejectedValueOnce(failure);
      if (stage === 'insert')
        clientQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure);
      if (stage === 'mark')
        clientQuery.mockResolvedValueOnce({ rows: [token] }).mockRejectedValueOnce(failure);
      const action =
        stage === 'invalidate' || stage === 'insert'
          ? repo.createPasswordResetToken({
              userId: 'user-1',
              tokenHash: 'hash',
              requestedIpHash: null,
              expiresAt: new Date('2026-11-05'),
            })
          : repo.consumePasswordResetToken('hash', async () => {
              if (stage === 'callback') throw failure;
              return true;
            });
      await expect(action).rejects.toBe(failure);
      expect(mocks.authTransaction).toHaveBeenCalledOnce();
    }
  );

  it('uses authQuery for standalone lookup and mark', async () => {
    await repo.findActivePasswordResetToken('hash');
    await repo.markPasswordResetTokenUsed('reset-1');
    expect(mocks.authQuery).toHaveBeenCalledTimes(2);
    expect(mocks.authQuery.mock.calls[0][0]).toContain('expires_at > now()');
    expect(mocks.authQuery.mock.calls[1][0]).toContain('used_at is null');
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
