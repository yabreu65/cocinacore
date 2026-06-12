import { type NextRequest, NextResponse } from 'next/server';
import { mapAuthError } from '@/lib/auth/errors';
import { SignupSchema } from '@/lib/auth/schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { findUserByEmail, createUser } from '@/lib/db/repositories/userRepository';
import { createTenant } from '@/lib/db/repositories/tenantRepository';
import { hashPassword } from '@/lib/auth/password';
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
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit(
    'auth/signup',
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

  const existingUser = await findUserByEmail(parsed.data.email);
  if (existingUser) {
    return NextResponse.json(
      { error: mapAuthError({ message: 'User already registered' }, 'signup') },
      { status: 400 }
    );
  }

  try {
    const tenant = await createTenant({ name: `Tenant of ${parsed.data.email}` });
    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date().toISOString();

    const user = await createUser({
      email: parsed.data.email,
      passwordHash,
      fullName: parsed.data.fullName,
      tenantId: tenant.id,
      role: 'owner',
      termsAcceptedAt: now,
      termsVersion: 'v1',
    });

    const session = await createSession(user.id);
    const response = NextResponse.json({ ok: true, user: session.user });
    await setSessionCookie(response, session);

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: mapAuthError(
          { message: error instanceof Error ? error.message : 'Signup failed' },
          'signup'
        ),
      },
      { status: 400 }
    );
  }
}
