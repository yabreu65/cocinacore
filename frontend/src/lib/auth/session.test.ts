import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';

const repositoryMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  hashSessionToken: vi.fn(),
  deleteSessionByTokenHash: vi.fn(),
  touchSessionLastSeen: vi.fn(),
}));
const userMocks = vi.hoisted(() => ({ findUserById: vi.fn() }));
const tenantMocks = vi.hoisted(() => ({ findTenantById: vi.fn() }));

vi.mock('@/lib/db/repositories/sessionRepository', () => repositoryMocks);
vi.mock('@/lib/db/repositories/userRepository', () => userMocks);
vi.mock('@/lib/db/repositories/tenantRepository', () => tenantMocks);

import { createSession, setSessionCookie } from './session';

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
  userMocks.findUserById.mockResolvedValue(user);
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
