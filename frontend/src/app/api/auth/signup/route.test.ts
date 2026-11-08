import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const checkRateLimitMock = vi.fn();
const findUserByEmailForAuthMock = vi.fn();
const createUserMock = vi.fn();
const createTenantMock = vi.fn();
const queryMock = vi.fn();
const hashPasswordMock = vi.fn();
const createSessionMock = vi.fn();
const setSessionCookieMock = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock('@/lib/db/repositories/userRepository', () => ({
  findUserByEmailForAuth: findUserByEmailForAuthMock,
  createUser: createUserMock,
}));
vi.mock('@/lib/db/repositories/tenantRepository', () => ({ createTenant: createTenantMock }));
const client = { query: queryMock };
const authTransactionMock = vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) =>
  callback(client)
);
vi.mock('@/lib/db', () => ({ authTransaction: authTransactionMock }));
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
    vi.stubEnv('COCINACORE_SIGNUP_MAINTENANCE', 'false');
    vi.stubEnv('COCINACORE_SIGNUP_BOOTSTRAP_ENABLED', 'false');
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 3, remaining: 2, resetAt: 1 });
    findUserByEmailForAuthMock.mockResolvedValue(null);
    createTenantMock.mockResolvedValue({ id: 'tenant-1' });
    hashPasswordMock.mockResolvedValue('hashed-password');
    createUserMock.mockResolvedValue({ id: 'user-1' });
    queryMock.mockResolvedValue({ rows: [] });
    createSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    setSessionCookieMock.mockResolvedValue(undefined);
  });

  it.each(['true', 'maintenance', ''])(
    'returns generic maintenance without parsing through signup or touching dependencies (%s)',
    async (flag) => {
      vi.stubEnv('COCINACORE_SIGNUP_MAINTENANCE', flag);
      const response = await POST(
        request({
          email: 'owner@example.test',
          password: 'SecurePassword123!',
          confirmPassword: 'SecurePassword123!',
          fullName: 'Owner',
          termsAccepted: true,
        }) as unknown as NextRequest
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'El registro no está disponible temporalmente.',
      });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(checkRateLimitMock).not.toHaveBeenCalled();
      expect(findUserByEmailForAuthMock).not.toHaveBeenCalled();
      expect(createTenantMock).not.toHaveBeenCalled();
      expect(createUserMock).not.toHaveBeenCalled();
      expect(queryMock).not.toHaveBeenCalled();
      expect(authTransactionMock).not.toHaveBeenCalled();
      expect(createSessionMock).not.toHaveBeenCalled();
      expect(setSessionCookieMock).not.toHaveBeenCalled();
    }
  );

  it('keeps signup enabled when the maintenance flag is unset', async () => {
    delete process.env.COCINACORE_SIGNUP_MAINTENANCE;
    try {
      const response = await POST(
        request({
          email: 'owner@example.test',
          password: 'SecurePassword123!',
          confirmPassword: 'SecurePassword123!',
          fullName: 'Owner',
          termsAccepted: true,
        }) as unknown as NextRequest
      );
      expect(response.status).toBe(200);
    } finally {
      process.env.COCINACORE_SIGNUP_MAINTENANCE = 'false';
    }
  });

  it('uses the same transaction client for bootstrap and session without legacy writes', async () => {
    vi.stubEnv('COCINACORE_SIGNUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'true');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgresql://cocinacore_auth@localhost/auth');
    vi.stubEnv('DATABASE_URL', 'postgresql://data@localhost/data');
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    queryMock.mockResolvedValueOnce({
      rows: [{ user_id: userId, tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    });
    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('public.signup_new_account'),
      expect.any(Array)
    );
    expect(createSessionMock).toHaveBeenCalledWith(userId, client);
    expect(createTenantMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('fails closed for invalid bootstrap configuration before database access', async () => {
    vi.stubEnv('COCINACORE_SIGNUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'false');
    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(400);
    expect(findUserByEmailForAuthMock).not.toHaveBeenCalled();
    expect(authTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['unexpected flag value', 'COCINACORE_SIGNUP_BOOTSTRAP_ENABLED', 'enabled'],
    ['wrong auth SQL role', 'AUTH_DATABASE_URL', 'postgresql://runtime@localhost/auth'],
    [
      'same SQL principal despite URL query differences',
      'DATABASE_URL',
      'postgresql://cocinacore_auth@localhost/auth?application_name=runtime',
    ],
  ])('fails closed for %s before database access', async (_label, key, value) => {
    vi.stubEnv('COCINACORE_SIGNUP_BOOTSTRAP_ENABLED', 'true');
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'true');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgresql://cocinacore_auth@localhost/auth');
    vi.stubEnv('DATABASE_URL', 'postgresql://cocinacore_runtime_rls@localhost/data');
    vi.stubEnv(key, value);
    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(400);
    expect(findUserByEmailForAuthMock).not.toHaveBeenCalled();
    expect(authTransactionMock).not.toHaveBeenCalled();
  });
  it('does not return a cookie if commit fails after response construction', async () => {
    authTransactionMock.mockImplementationOnce(async (callback) => {
      await callback(client);
      throw new Error('commit failed');
    });
    const response = await POST(
      request({
        email: 'owner@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
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
    expect(authTransactionMock).toHaveBeenCalledOnce();
    expect(findUserByEmailForAuthMock).toHaveBeenCalledWith('owner@example.test');
    expect(hashPasswordMock).toHaveBeenCalledWith('SecurePassword123!');
    expect(setSessionCookieMock).toHaveBeenCalledOnce();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        role: 'owner',
        passwordHash: 'hashed-password',
        termsVersion: 'v1',
        termsAcceptedAt: expect.any(String) as unknown as string,
      }),
      client
    );
    expect(queryMock).toHaveBeenCalledWith(
      `insert into public.tenant_memberships (tenant_id, user_id, role)
       values ($1, $2, 'owner')`,
      ['tenant-1', 'user-1']
    );
    expect(createSessionMock).toHaveBeenCalledWith('user-1', client);
    expect(createTenantMock).toHaveBeenCalledWith(expect.anything(), client);
  });

  it('returns the session cookie on success', async () => {
    setSessionCookieMock.mockImplementationOnce(
      (response: { cookies: { set: (name: string, value: string) => void } }) => {
        response.cookies.set('cocinacore_session', 'session-token');
        return Promise.resolve();
      }
    );
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
    expect(await response.json()).toEqual({ ok: true, user: { id: 'user-1' } });
    expect(response.headers.get('set-cookie')).toContain('cocinacore_session=session-token');
  });

  it.each(['tenant', 'user', 'session'] as const)(
    'returns no cookie and stops on %s creation failure',
    async (stage) => {
      const failure = new Error(`${stage} failed`);
      if (stage === 'tenant') createTenantMock.mockRejectedValueOnce(failure);
      if (stage === 'user') createUserMock.mockRejectedValueOnce(failure);
      if (stage === 'session') createSessionMock.mockRejectedValueOnce(failure);
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
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(authTransactionMock).toHaveBeenCalledOnce();
      if (stage === 'tenant') expect(createUserMock).not.toHaveBeenCalled();
      if (stage === 'user') expect(queryMock).not.toHaveBeenCalled();
      if (stage !== 'session') expect(createSessionMock).not.toHaveBeenCalled();
      expect(setSessionCookieMock).not.toHaveBeenCalled();
    }
  );

  it('returns the existing duplicate response without starting a transaction', async () => {
    findUserByEmailForAuthMock.mockResolvedValueOnce({ id: 'existing' });
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
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(authTransactionMock).not.toHaveBeenCalled();
    expect(hashPasswordMock).not.toHaveBeenCalled();
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

  it('does not expose a success response if commit fails', async () => {
    authTransactionMock.mockImplementationOnce(async (callback) => {
      await callback(client);
      throw new Error('commit failed');
    });
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
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns no cookie when cookie preparation fails', async () => {
    setSessionCookieMock.mockRejectedValueOnce(new Error('cookie failure'));
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
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('handles lookup failures without leaking database details', async () => {
    findUserByEmailForAuthMock.mockRejectedValueOnce(new Error('private database details'));
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
    expect(JSON.stringify(await response.json())).not.toContain('private database details');
    expect(authTransactionMock).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate email to the same safe response as the precheck', async () => {
    authTransactionMock.mockRejectedValueOnce({
      code: '23505',
      constraint: 'users_email_key',
      detail: 'secret',
    });
    const body = {
      email: 'owner@example.test',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
      fullName: 'Tenant Owner',
      termsAccepted: true,
    };
    const concurrent = await POST(request(body) as unknown as NextRequest);
    findUserByEmailForAuthMock.mockResolvedValueOnce({ id: 'existing' });
    const existing = await POST(request(body) as unknown as NextRequest);
    expect(concurrent.status).toBe(400);
    expect(await concurrent.json()).toEqual(await existing.json());
  });

  it('applies both target and anonymous-global signup limits', async () => {
    const response = await POST(
      request({
        email: 'second@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Second Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(
      2,
      'auth/signup:anonymous-global',
      'global',
      undefined,
      { requireSharedStore: true }
    );
  });

  it('rejects when the anonymous-global signup bucket is exhausted', async () => {
    checkRateLimitMock
      .mockResolvedValueOnce({ success: true, limit: 5, remaining: 4, resetAt: 100 })
      .mockResolvedValueOnce({ success: false, limit: 100, remaining: 0, resetAt: 100 });

    const response = await POST(
      request({
        email: 'third@example.test',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Third Owner',
        termsAccepted: true,
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(429);
    expect(createTenantMock).not.toHaveBeenCalled();
  });
});
