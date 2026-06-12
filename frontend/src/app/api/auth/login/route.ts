import { type NextRequest, NextResponse } from 'next/server';
import { mapAuthError } from '@/lib/auth/errors';
import { LoginSchema } from '@/lib/auth/schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { findUserByEmail } from '@/lib/db/repositories/userRepository';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function hashIdentity(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.toLowerCase()));
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

  const rateLimit = await checkRateLimit(
    'auth/login',
    getIp(request),
    await hashIdentity(parsed.data.email)
  );
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const user = await findUserByEmail(parsed.data.email);
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
