import { type NextRequest, NextResponse } from 'next/server';
import { mapAuthError } from '@/lib/auth/errors';
import { SignupSchema } from '@/lib/auth/schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { findUserByEmailForAuth, createUser } from '@/lib/db/repositories/userRepository';
import { createTenant } from '@/lib/db/repositories/tenantRepository';
import { authTransaction } from '@/lib/db';
import {
  createSignupBootstrap,
  signupBootstrapEnabled,
} from '@/lib/db/repositories/signupBootstrapRepository';
import { hashPassword } from '@/lib/auth/password';
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

function signupMaintenanceEnabled(): boolean {
  const flag = process.env.COCINACORE_SIGNUP_MAINTENANCE;
  if (flag === undefined || flag === 'false') return false;
  return true;
}

export async function POST(request: NextRequest) {
  if (signupMaintenanceEnabled()) {
    return NextResponse.json(
      { error: 'El registro no está disponible temporalmente.' },
      { status: 503 }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
      { status: 400 }
    );
  }

  const targetKey = await hashIdentity(parsed.data.email);
  const rateLimitKey = getTargetRateLimitKey(request, targetKey);
  const targetRateLimit = await checkRateLimit(
    'auth/signup',
    rateLimitKey.identity,
    rateLimitKey.userId,
    { requireSharedStore: true }
  );
  const secondaryKey = getAuthenticationSecondaryRateLimitKey(request, 'auth/signup');
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

  try {
    const bootstrap = signupBootstrapEnabled();
    const existingUser = await findUserByEmailForAuth(parsed.data.email);
    if (existingUser) {
      return NextResponse.json({ error: mapAuthError(null, 'signup') }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    return await authTransaction(async (client) => {
      const now = new Date().toISOString();
      let userId: string;
      if (bootstrap) {
        const created = await createSignupBootstrap(client, {
          email: parsed.data.email,
          passwordHash,
          fullName: parsed.data.fullName,
          termsAcceptedAt: now,
          termsVersion: 'v1',
        });
        userId = created.userId;
      } else {
        const tenant = await createTenant({ name: `Tenant of ${parsed.data.email}` }, client);
        const user = await createUser(
          {
            email: parsed.data.email,
            passwordHash,
            fullName: parsed.data.fullName,
            tenantId: tenant.id,
            role: 'owner',
            termsAcceptedAt: now,
            termsVersion: 'v1',
          },
          client
        );
        await client.query(
          `insert into public.tenant_memberships (tenant_id, user_id, role)
       values ($1, $2, 'owner')`,
          [tenant.id, user.id]
        );
        userId = user.id;
      }

      const session = await createSession(userId, client);
      const response = NextResponse.json({ ok: true, user: session.user });
      await setSessionCookie(response, session);
      return response;
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'users_email_key'
    ) {
      return NextResponse.json({ error: mapAuthError(null, 'signup') }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: mapAuthError({ message: 'Signup failed' }, 'signup'),
      },
      { status: 400 }
    );
  }
}
