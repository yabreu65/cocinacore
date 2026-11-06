import { type NextRequest, NextResponse } from 'next/server';
import { AuthEmailSchema } from '@/lib/auth/schemas';
import {
  generatePasswordResetToken,
  getPasswordResetExpiry,
  hashPasswordResetIdentity,
  hashPasswordResetToken,
} from '@/lib/auth/password-reset';
import { createPasswordResetToken } from '@/lib/db/repositories/passwordResetRepository';
import { findUserByEmailForAuth } from '@/lib/db/repositories/userRepository';
import { getAppPublicUrl, sendPasswordResetEmail } from '@/lib/email/resend';
import { checkRateLimit } from '@/lib/rate-limit';
import { serverLogger } from '@/lib/serverLogger';
import { getSafeErrorReason } from '@/lib/safe-error-reason';
import {
  getAuthenticationSecondaryRateLimitKey,
  getRetryAfterSeconds,
  getTargetRateLimitKey,
  getTrustedClientIdentity,
} from '@/lib/rate-limit-identity';

export const runtime = 'nodejs';

const GENERIC_RESPONSE = {
  ok: true,
  message:
    'Si el correo existe en CocinaCore, te enviaremos instrucciones para restablecer la contraseña.',
};

function buildResetUrl(token: string): string {
  const url = new URL('/reset-password', getAppPublicUrl());
  url.searchParams.set('token', token);
  return url.toString();
}

function emailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
    process.env.RESEND_API_KEY !== 'CHANGE_ME' &&
    process.env.EMAIL_FROM?.trim() &&
    process.env.EMAIL_FROM !== 'CHANGE_ME' &&
    process.env.APP_PUBLIC_URL?.trim() &&
    process.env.APP_PUBLIC_URL !== 'CHANGE_ME'
  );
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const body: unknown = await request.json().catch(() => null);
  const parsed = AuthEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ingresá un correo válido.' }, { status: 400 });
  }

  const emailHash = hashPasswordResetIdentity(parsed.data.email);
  const clientIdentity = getTrustedClientIdentity(request);
  const rateLimitKey = getTargetRateLimitKey(request, emailHash);
  const targetRateLimit = await checkRateLimit(
    'auth/password-reset',
    rateLimitKey.identity,
    rateLimitKey.userId,
    {
      requireSharedStore: true,
    }
  );
  const secondaryKey = getAuthenticationSecondaryRateLimitKey(request, 'auth/password-reset');
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

  if (!emailConfigured()) {
    serverLogger.error('auth.password_reset.email_not_configured', {});
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const user = await findUserByEmailForAuth(parsed.data.email);
  if (!user) {
    return NextResponse.json(GENERIC_RESPONSE);
  }

  try {
    const token = generatePasswordResetToken();
    await createPasswordResetToken({
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      requestedIpHash: hashPasswordResetIdentity(clientIdentity),
      expiresAt: getPasswordResetExpiry(),
    });

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: buildResetUrl(token),
    });
  } catch (error) {
    serverLogger.error('auth.password_reset.request_failed', {
      requestId,
      reason: getSafeErrorReason(error),
    });
    return NextResponse.json(GENERIC_RESPONSE);
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
