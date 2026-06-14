import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const checkRateLimitMock = vi.fn();
const consumePasswordResetTokenMock = vi.fn();
const hashPasswordMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: hashPasswordMock,
}));

vi.mock('@/lib/db/repositories/passwordResetRepository', () => ({
  consumePasswordResetToken: consumePasswordResetTokenMock,
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
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 5, remaining: 4, resetAt: 1 });
    hashPasswordMock.mockResolvedValue('hashed-password');
    consumePasswordResetTokenMock.mockReset();
  });

  it('updates password through a consumed token', async () => {
    consumePasswordResetTokenMock.mockImplementation(
      async (_hash: string, callback: PasswordResetCallback) => {
      await callback(
        { query: vi.fn().mockResolvedValue({}) },
        { id: 'token-1', user_id: 'user-1' }
      );
      return true;
    });

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(consumePasswordResetTokenMock).toHaveBeenCalled();
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

  it('returns 500 when token consumption fails unexpectedly', async () => {
    consumePasswordResetTokenMock.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(
      request({
        token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(500);
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
