import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

const { authQueryMock, queryMock, mapMock } = vi.hoisted(() => ({
  authQueryMock: vi.fn(),
  queryMock: vi.fn(),
  mapMock: vi.fn((result: { rows: unknown[] }) => result.rows[0] ?? null),
}));
vi.mock('@/lib/db', () => ({ authQuery: authQueryMock, query: queryMock, mapSingleRow: mapMock }));
const repo = await import('./sessionRepository');

describe('auth session repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authQueryMock.mockResolvedValue({ rows: [{ id: 'session-1' }] });
  });

  it('uses auth SQL for session lifecycle and forwards cancellation options', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const options = { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 };
    await repo.createSession('user-1', 'hash', date);
    await repo.findSessionByTokenHash('hash', options);
    await repo.touchSessionLastSeen('hash', options);
    await repo.deleteSessionByTokenHash('hash');
    await repo.deleteSessionsByUserId('user-1');
    await repo.deleteExpiredSessions();
    expect(authQueryMock).toHaveBeenCalledTimes(6);
    expect(authQueryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('insert into public.sessions'),
      ['user-1', 'hash', date.toISOString()]
    );
    expect(authQueryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('expires_at > now()'),
      ['hash'],
      options
    );
    expect(authQueryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('set last_seen_at'),
      ['hash'],
      options
    );
    expect(authQueryMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('delete from public.sessions where token_hash'),
      ['hash']
    );
    expect(authQueryMock).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('delete from public.sessions where user_id'),
      ['user-1']
    );
    expect(authQueryMock).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('delete from public.sessions where expires_at')
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction client without a second connection', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'session-1' }] }) };
    await repo.createSession(
      'user-1',
      'hash',
      new Date('2026-01-01'),
      client as unknown as PoolClient
    );
    expect(client.query).toHaveBeenCalledOnce();
    expect(authQueryMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns null for an absent or expired session', async () => {
    authQueryMock.mockResolvedValueOnce({ rows: [] });
    await expect(repo.findSessionByTokenHash('missing')).resolves.toBeNull();
  });
});
