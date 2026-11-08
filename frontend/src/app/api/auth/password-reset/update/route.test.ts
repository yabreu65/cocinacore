import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const checkRateLimitMock = vi.fn();
const consumePasswordResetTokenMock = vi.fn();
const hashPasswordMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: hashPasswordMock,
}));

vi.mock('@/lib/db/repositories/passwordResetRepository', () => ({
  consumePasswordResetToken: consumePasswordResetTokenMock,
}));

vi.mock('@/lib/serverLogger', () => ({
  serverLogger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}));

const { POST } = await import('./route');

type PasswordResetCallback = (
  client: { query: ReturnType<typeof vi.fn> },
  token: { id: string; user_id: string }
) => Promise<boolean>;

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/auth/password-reset/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/password-reset/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 5, remaining: 4, resetAt: 1 });
    hashPasswordMock.mockResolvedValue('hashed-password');
    consumePasswordResetTokenMock.mockReset();
    loggerErrorMock.mockReset();
  });

  it('updates password through a consumed token', async () => {
    const clientQuery = vi.fn().mockResolvedValue({});
    consumePasswordResetTokenMock.mockImplementation(
      async (_hash: string, callback: PasswordResetCallback) => {
        await callback({ query: clientQuery }, { id: 'token-1', user_id: 'user-1' });
        return true;
      }
    );

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(consumePasswordResetTokenMock).toHaveBeenCalled();
    expect(hashPasswordMock).toHaveBeenCalledWith('NewPassword123!');
    expect(clientQuery.mock.calls).toEqual([
      [
        'update public.users set password_hash = $1, updated_at = now() where id = $2',
        ['hashed-password', 'user-1'],
      ],
      ['delete from public.sessions where user_id = $1', ['user-1']],
    ]);
    expect(consumePasswordResetTokenMock.mock.calls[0][0]).not.toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    );
  });

  it('rejects invalid or expired tokens', async () => {
    consumePasswordResetTokenMock.mockResolvedValue(null);

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(401);
  });

  it('rate limits password reset updates', async () => {
    checkRateLimitMock.mockResolvedValue({ success: false, limit: 5, remaining: 0, resetAt: 100 });

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(429);
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('scopes the target bucket to the token hash and applies a global secondary bucket', async () => {
    consumePasswordResetTokenMock.mockResolvedValue(true);

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(
      2,
      'auth/password-update:anonymous-global',
      'global',
      undefined,
      { requireSharedStore: true }
    );
    expect(checkRateLimitMock.mock.calls[0]?.[0]).toBe('auth/password-update');
    expect(checkRateLimitMock.mock.calls[0]?.[1]).not.toBe('anonymous');
  });

  it('rejects when the global password-update bucket is exhausted', async () => {
    checkRateLimitMock
      .mockResolvedValueOnce({ success: true, limit: 5, remaining: 4, resetAt: 100 })
      .mockResolvedValueOnce({ success: false, limit: 50, remaining: 0, resetAt: 100 });

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(429);
    expect(consumePasswordResetTokenMock).not.toHaveBeenCalled();
  });

  it('returns 500 when token consumption fails unexpectedly', async () => {
    consumePasswordResetTokenMock.mockRejectedValue(
      new Error('database unavailable password=super-secret sql=select token_hash')
    );

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(500);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'auth.password_reset.update_failed',
      expect.objectContaining({ reason: 'unknown_error' })
    );
    const logPayload = loggerErrorMock.mock.calls[0]?.[1] as { requestId?: unknown };
    expect(typeof logPayload.requestId).toBe('string');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('super-secret');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('select token_hash');
  });

  it('rejects mismatched passwords', async () => {
    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'a',
        confirmPassword: 'b',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
  });
});
