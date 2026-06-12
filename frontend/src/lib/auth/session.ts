import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { type NextRequest, type NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  createSession as createSessionRow,
  findSessionByTokenHash,
  hashSessionToken,
  deleteSessionByTokenHash,
  touchSessionLastSeen,
} from '@/lib/db/repositories/sessionRepository';
import { findUserById } from '@/lib/db/repositories/userRepository';
import { findTenantById } from '@/lib/db/repositories/tenantRepository';
import { AuthUser, AuthSession, TenantContext } from './types';
import { serverLogger } from '@/lib/serverLogger';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getCookieName(): string {
  return process.env.AUTH_COOKIE_NAME?.trim() || 'cocinacore_session';
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim() === '' || secret === 'CHANGE_ME') {
    throw new Error('AUTH_SECRET environment variable is required and must be changed.');
  }
  return new TextEncoder().encode(secret);
}

function getSessionTtlSeconds(): number {
  const raw = process.env.AUTH_SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_SESSION_TTL_SECONDS;
  return parsed;
}

interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

function buildCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: getSessionTtlSeconds(),
  };
}

export async function createSession(userId: string): Promise<AuthSession> {
  const secret = getSecret();
  const ttlSeconds = getSessionTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);

  const tokenHash = hashSessionToken(token);
  await createSessionRow(userId, tokenHash, expiresAt);

  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found after session creation');
  }

  return {
    token,
    expiresAt,
    user: await buildAuthUser(user),
  };
}

export async function buildAuthUser(
  user: Awaited<ReturnType<typeof findUserById>> & {}
): Promise<AuthUser> {
  if (!user) {
    throw new Error('User is required to build AuthUser');
  }

  let tenant: TenantContext | null = null;
  if (user.tenant_id) {
    const tenantRow = await findTenantById(user.tenant_id);
    if (tenantRow) {
      tenant = {
        tenantId: tenantRow.id,
        role: user.role,
        tenantType: tenantRow.tenant_type,
        onboardingCompleted: user.onboarding_completed,
      };
    }
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    tenant,
    termsAcceptedAt: user.terms_accepted_at,
    termsVersion: user.terms_version,
    onboardingCompleted: user.onboarding_completed,
  };
}

export async function resolveSessionToken(token: string): Promise<AuthSession | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    const userId = payload.sub;
    if (!userId) return null;

    const tokenHash = hashSessionToken(token);
    const sessionRow = await findSessionByTokenHash(tokenHash);
    if (!sessionRow) return null;

    const user = await findUserById(userId);
    if (!user) return null;

    await touchSessionLastSeen(tokenHash);

    return {
      token,
      expiresAt: new Date(sessionRow.expires_at),
      user: await buildAuthUser(user),
    };
  } catch (error) {
    serverLogger.warn('auth.session.resolve_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getSessionFromRequest(request: NextRequest): Promise<AuthSession | null> {
  const cookieValue = request.cookies.get(getCookieName())?.value;
  if (!cookieValue) return null;
  return resolveSessionToken(cookieValue);
}

export async function getSessionFromCookies(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getCookieName())?.value;
  if (!cookieValue) return null;
  return resolveSessionToken(cookieValue);
}

export async function setSessionCookie(response: NextResponse, session: AuthSession): Promise<void> {
  response.cookies.set(getCookieName(), session.token, buildCookieOptions());
}

export async function clearSessionCookie(response: NextResponse): Promise<void> {
  response.cookies.set(getCookieName(), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function revokeSession(request: NextRequest, response: NextResponse): Promise<void> {
  const token = request.cookies.get(getCookieName())?.value;
  if (token) {
    await deleteSessionByTokenHash(hashSessionToken(token));
  }
  await clearSessionCookie(response);
}

export function generateSessionTokenForTesting(userId: string): string {
  // Not exported from barrel; only for tests if needed.
  return crypto.randomUUID() + userId;
}
