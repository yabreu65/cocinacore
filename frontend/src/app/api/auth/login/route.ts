import { type NextRequest, NextResponse } from 'next/server';
import { mapAuthError } from '@/lib/auth/errors';
import { LoginSchema } from '@/lib/auth/schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { findUserByEmailForAuth } from '@/lib/db/repositories/userRepository';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import {
  getAuthenticationSecondaryRateLimitKey,
  getRetryAfterSeconds,
  getTargetRateLimitKey,
} from '@/lib/rate-limit-identity';

async function hashIdentity(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.toLowerCase())
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
      { status: 400 }
    );
  }

  const targetKey = await hashIdentity(parsed.data.email);
  const rateLimitKey = getTargetRateLimitKey(request, targetKey);
  const targetRateLimit = await checkRateLimit(
    'auth/login',
    rateLimitKey.identity,
    rateLimitKey.userId,
    {
      requireSharedStore: true,
    }
  );
  const secondaryKey = getAuthenticationSecondaryRateLimitKey(request, 'auth/login');
  const secondaryRateLimit = targetRateLimit.success
    ? await checkRateLimit(secondaryKey.route, secondaryKey.identity, undefined, {
        requireSharedStore: true,
      })
    : targetRateLimit;
  const rateLimit = targetRateLimit.success ? secondaryRateLimit : targetRateLimit;
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      {
        status: rateLimit.storage === 'unavailable' ? 503 : 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }

  const user = await findUserByEmailForAuth(parsed.data.email);
  if (!user) {
    return NextResponse.json(
      { error: mapAuthError({ message: 'Invalid login credentials' }, 'login') },
      { status: 401 }
    );
  }

  const passwordValid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!passwordValid) {
    return NextResponse.json(
      { error: mapAuthError({ message: 'Invalid login credentials' }, 'login') },
      { status: 401 }
    );
  }

  const session = await createSession(user.id);
  const response = NextResponse.json({ ok: true, user: session.user });
  await setSessionCookie(response, session);

  return response;
}
