import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify, SignJWT } from 'jose';

const cookieGet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));

const repositoryMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  hashSessionToken: vi.fn(),
  deleteSessionByTokenHash: vi.fn(),
  touchSessionLastSeen: vi.fn(),
}));
const userMocks = vi.hoisted(() => ({ findUserByIdForAuth: vi.fn() }));
const tenantMocks = vi.hoisted(() => ({ findTenantByIdForAuth: vi.fn() }));

vi.mock('@/lib/db/repositories/sessionRepository', () => repositoryMocks);
vi.mock('@/lib/db/repositories/userRepository', () => userMocks);
vi.mock('@/lib/db/repositories/tenantRepository', () => tenantMocks);

import {
  createSession,
  setSessionCookie,
  resolveSessionToken,
  getSessionFromRequest,
  revokeSession,
  getSessionFromCookies,
} from './session';

import { getCurrentUser, requireUser } from './server';

const user = {
  id: 'user-1',
  email: 'user@example.com',
  full_name: 'Test User',
  tenant_id: null,
  role: 'member' as const,
  onboarding_completed: true,
  terms_accepted_at: null,
  terms_version: null,
};

async function createSessionAndGetCookieMaxAge() {
  userMocks.findUserByIdForAuth.mockResolvedValue(user);
  const session = await createSession(user.id);
  let cookieMaxAge: number | undefined;
  let cookieName: string | undefined;
  const response = {
    cookies: {
      set: (name: string, _value: string, options: { maxAge: number }) => {
        cookieName = name;
        cookieMaxAge = options.maxAge;
      },
    },
  } as Parameters<typeof setSessionCookie>[0];
  await setSessionCookie(response, session);
  return { session, cookieMaxAge, cookieName };
}

describe('session lifetime configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'test-only-auth-secret';
    delete process.env.AUTH_SESSION_TTL_SECONDS;
    delete process.env.SESSION_DAYS;
    delete process.env.AUTH_COOKIE_NAME;
    repositoryMocks.hashSessionToken.mockResolvedValue('token-hash');
  });

  it('uses legacy SESSION_DAYS for JWT, database expiry, and cookie maxAge', async () => {
    process.env.SESSION_DAYS = '30';
    const before = Date.now();

    const { session, cookieMaxAge, cookieName } = await createSessionAndGetCookieMaxAge();
    const expectedTtlSeconds = 2_592_000;
    const { payload } = await jwtVerify(
      session.token,
      new TextEncoder().encode(process.env.AUTH_SECRET)
    );

    expect(payload.exp).toBe(Math.floor(session.expiresAt.getTime() / 1000));
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedTtlSeconds * 1000);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + expectedTtlSeconds * 1000);
    expect(repositoryMocks.createSession).toHaveBeenCalledWith(
      user.id,
      'token-hash',
      session.expiresAt
    );
    expect(cookieMaxAge).toBe(expectedTtlSeconds);
    expect(cookieName).toBe('cocinacore_session');
  });

  it('prefers AUTH_SESSION_TTL_SECONDS over SESSION_DAYS', async () => {
    process.env.AUTH_SESSION_TTL_SECONDS = '120';
    process.env.SESSION_DAYS = '30';

    const { session, cookieMaxAge } = await createSessionAndGetCookieMaxAge();
    const { payload } = await jwtVerify(
      session.token,
      new TextEncoder().encode(process.env.AUTH_SECRET)
    );

    expect(payload.exp).toBe(Math.floor(session.expiresAt.getTime() / 1000));
    expect(cookieMaxAge).toBe(120);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it('keeps the seven-day fallback when the configured TTL is explicitly invalid', async () => {
    process.env.AUTH_SESSION_TTL_SECONDS = '0';
    process.env.SESSION_DAYS = '30';

    const { session, cookieMaxAge } = await createSessionAndGetCookieMaxAge();

    expect(cookieMaxAge).toBe(604_800);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 604_800_000);
  });
});

describe('session resolution and revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'test-only-auth-secret';
    delete process.env.AUTH_COOKIE_NAME;
    repositoryMocks.hashSessionToken.mockResolvedValue('token-hash');
    userMocks.findUserByIdForAuth.mockResolvedValue({ ...user, tenant_id: 'tenant-1' });
    tenantMocks.findTenantByIdForAuth.mockResolvedValue({ id: 'tenant-1', tenant_type: 'home' });
    repositoryMocks.findSessionByTokenHash.mockResolvedValue({ user_id: user.id });
  });

  it('resolves a valid JWT using auth lookups and touches the session', async () => {
    const session = await createSession(user.id);
    const options = { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 };
    const resolved = await resolveSessionToken(session.token, options);
    expect(resolved?.user.tenant?.tenantId).toBe('tenant-1');
    expect(repositoryMocks.findSessionByTokenHash).toHaveBeenCalledWith('token-hash', options);
    expect(userMocks.findUserByIdForAuth).toHaveBeenCalledWith(user.id, options);
    expect(tenantMocks.findTenantByIdForAuth).toHaveBeenCalledWith('tenant-1', options, undefined);
    expect(repositoryMocks.touchSessionLastSeen).toHaveBeenCalledWith('token-hash', options);
  });

  it('returns null when a session is missing, revoked or expired in storage', async () => {
    const session = await createSession(user.id);
    userMocks.findUserByIdForAuth.mockClear();
    repositoryMocks.findSessionByTokenHash.mockResolvedValueOnce(null);
    await expect(resolveSessionToken(session.token)).resolves.toBeNull();
    expect(userMocks.findUserByIdForAuth).not.toHaveBeenCalled();
    expect(repositoryMocks.touchSessionLastSeen).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT before querying storage', async () => {
    const token = await new SignJWT({ email: user.email, role: 'member', tenantType: 'home' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setExpirationTime('1 second ago')
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await expect(resolveSessionToken(token)).resolves.toBeNull();
    expect(repositoryMocks.findSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('reuses an explicit signup client for user, tenant and session creation', async () => {
    const client = { query: vi.fn() } as unknown as NonNullable<
      Parameters<typeof createSession>[1]
    >;
    await createSession(user.id, client);
    expect(userMocks.findUserByIdForAuth).toHaveBeenCalledWith(user.id, undefined, client);
    expect(tenantMocks.findTenantByIdForAuth).toHaveBeenCalledWith('tenant-1', undefined, client);
    expect(repositoryMocks.createSession).toHaveBeenCalledWith(
      user.id,
      'token-hash',
      expect.any(Date),
      client
    );
  });

  it('resolves cookie and server helpers, and rejects missing authentication', async () => {
    const session = await createSession(user.id);
    cookieGet.mockReturnValueOnce({ value: session.token });
    expect((await getSessionFromCookies())?.user.id).toBe(user.id);
    cookieGet.mockReturnValueOnce({ value: session.token });
    expect((await getCurrentUser())?.id).toBe(user.id);
    const request = { cookies: { get: () => ({ value: session.token }) } } as unknown as Parameters<
      typeof requireUser
    >[0];
    expect((await requireUser(request)).id).toBe(user.id);
    cookieGet.mockReturnValueOnce(undefined);
    await expect(requireUser()).rejects.toThrow('Unauthorized');
  });

  it('reads the request cookie and revokes its hash on logout', async () => {
    const session = await createSession(user.id);
    const request = { cookies: { get: () => ({ value: session.token }) } } as unknown as Parameters<
      typeof getSessionFromRequest
    >[0];
    expect((await getSessionFromRequest(request))?.user.id).toBe(user.id);
    const set = vi.fn();
    const response = { cookies: { set } } as unknown as Parameters<typeof revokeSession>[1];
    await revokeSession(request, response);
    expect(repositoryMocks.deleteSessionByTokenHash).toHaveBeenCalledWith('token-hash');
    expect(set).toHaveBeenCalledWith(
      'cocinacore_session',
      '',
      expect.objectContaining({ maxAge: 0 })
    );
  });
});
