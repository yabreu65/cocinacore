import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const checkRateLimitMock = vi.fn();
const findUserByEmailMock = vi.fn();
const createUserMock = vi.fn();
const createTenantMock = vi.fn();
const queryMock = vi.fn();
const hashPasswordMock = vi.fn();
const createSessionMock = vi.fn();
const setSessionCookieMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock('@/lib/db/repositories/userRepository', () => ({
  findUserByEmail: findUserByEmailMock,
  createUser: createUserMock,
}));
vi.mock('@/lib/db/repositories/tenantRepository', () => ({ createTenant: createTenantMock }));
vi.mock('@/lib/db', () => ({ query: queryMock }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: hashPasswordMock }));
vi.mock('@/lib/auth/session', () => ({
  createSession: createSessionMock,
  setSessionCookie: setSessionCookieMock,
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 3, remaining: 2, resetAt: 1 });
    findUserByEmailMock.mockResolvedValue(null);
    createTenantMock.mockResolvedValue({ id: 'tenant-1' });
    hashPasswordMock.mockResolvedValue('hashed-password');
    createUserMock.mockResolvedValue({ id: 'user-1' });
    queryMock.mockResolvedValue({ rows: [] });
    createSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    setSessionCookieMock.mockResolvedValue(undefined);
  });

  it('creates the tenant owner membership before creating a session', async () => {
    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Tenant Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', role: 'owner' })
    );
    expect(queryMock).toHaveBeenCalledWith(
      `insert into public.tenant_memberships (tenant_id, user_id, role)
       values ($1, $2, 'owner')`,
      ['tenant-1', 'user-1']
    );
    expect(createSessionMock).toHaveBeenCalledWith('user-1');
  });

  it('returns signup error and does not create a session when membership creation fails', async () => {
    queryMock.mockRejectedValue(new Error('membership insert failed'));

    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Tenant Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
