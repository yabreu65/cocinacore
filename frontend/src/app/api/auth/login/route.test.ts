import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rate: vi.fn(),
  findUser: vi.fn(),
  verify: vi.fn(),
  create: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/db/repositories/userRepository', () => ({ findUserByEmailForAuth: mocks.findUser }));
vi.mock('@/lib/auth/password', () => ({ verifyPassword: mocks.verify }));
vi.mock('@/lib/auth/session', () => ({
  createSession: mocks.create,
  setSessionCookie: mocks.cookie,
}));
const { POST } = await import('./route');
function request() {
  return new Request('https://example.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'password' }),
  }) as unknown as NextRequest;
}

describe('login auth SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockResolvedValue({ success: true, limit: 3, remaining: 2, resetAt: 1 });
    mocks.findUser.mockResolvedValue({ id: 'user-1', password_hash: 'hash' });
    mocks.verify.mockResolvedValue(true);
    mocks.create.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.cookie.mockImplementation(
      (response: { cookies: { set: (name: string, value: string) => void } }) => {
        response.cookies.set('cocinacore_session', 'token');
        return Promise.resolve();
      }
    );
  });
  it('checks credentials and returns the session cookie', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledWith('owner@example.test');
    expect(mocks.verify).toHaveBeenCalledWith('password', 'hash');
    expect(mocks.create).toHaveBeenCalledWith('user-1');
    expect(response.headers.get('set-cookie')).toContain('cocinacore_session=token');
    expect(await response.json()).toEqual({ ok: true, user: { id: 'user-1' } });
  });
  it('rejects unknown users and incorrect passwords without creating sessions', async () => {
    mocks.findUser.mockResolvedValueOnce(null);
    const missing = await POST(request());
    mocks.verify.mockResolvedValueOnce(false);
    const badPassword = await POST(request());
    expect(missing.status).toBe(401);
    expect(badPassword.status).toBe(401);
    expect(await missing.json()).toEqual(await badPassword.json());
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('blocks rate-limited requests before lookup', async () => {
    mocks.rate.mockResolvedValueOnce({ success: false, limit: 3, remaining: 0, resetAt: 1 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
});
