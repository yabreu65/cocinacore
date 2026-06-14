import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const checkRateLimitMock = vi.fn();
const findUserByEmailMock = vi.fn();
const createPasswordResetTokenMock = vi.fn();
const sendPasswordResetEmailMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/db/repositories/userRepository', () => ({
  findUserByEmail: findUserByEmailMock,
}));

vi.mock('@/lib/db/repositories/passwordResetRepository', () => ({
  createPasswordResetToken: createPasswordResetTokenMock,
}));

vi.mock('@/lib/email/resend', () => ({
  getAppPublicUrl: () => 'https://app.example.test',
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/password-reset/request', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'CocinaCore <no-reply@example.test>');
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test');
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 3, remaining: 2, resetAt: 1 });
    findUserByEmailMock.mockReset();
    createPasswordResetTokenMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
  });

  it('returns a generic success for unknown email without sending email', async () => {
    findUserByEmailMock.mockResolvedValue(null);

    const response = await POST(request({ email: 'missing@example.test' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it('creates a reset token and sends email for existing users', async () => {
    findUserByEmailMock.mockResolvedValue({ id: 'user-1', email: 'user@example.test' });

    const response = await POST(request({ email: 'user@example.test' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createPasswordResetTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.test' })
    );
  });



  it('returns a generic success when email delivery is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 'CHANGE_ME');
    findUserByEmailMock.mockResolvedValue({ id: 'user-1', email: 'user@example.test' });

    const response = await POST(request({ email: 'user@example.test' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createPasswordResetTokenMock).not.toHaveBeenCalled();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it('returns a generic success when email sending fails', async () => {
    findUserByEmailMock.mockResolvedValue({ id: 'user-1', email: 'user@example.test' });
    sendPasswordResetEmailMock.mockRejectedValue(new Error('resend unavailable'));

    const response = await POST(request({ email: 'user@example.test' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createPasswordResetTokenMock).toHaveBeenCalled();
  });



  it('rate limits password reset requests before user lookup', async () => {
    checkRateLimitMock.mockResolvedValue({ success: false, limit: 3, remaining: 0, resetAt: 100 });

    const response = await POST(request({ email: 'user@example.test' }) as unknown as NextRequest);

    expect(response.status).toBe(429);
    expect(findUserByEmailMock).not.toHaveBeenCalled();
  });

  it('rejects invalid email', async () => {
    const response = await POST(request({ email: 'invalid' }) as unknown as NextRequest);

    expect(response.status).toBe(400);
  });
});
