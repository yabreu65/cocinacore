import { type NextRequest, NextResponse } from 'next/server';
import { AuthEmailSchema } from '@/lib/auth/schemas';
import {
  generatePasswordResetToken,
  getPasswordResetExpiry,
  hashPasswordResetIdentity,
  hashPasswordResetToken,
} from '@/lib/auth/password-reset';
import { createPasswordResetToken } from '@/lib/db/repositories/passwordResetRepository';
import { findUserByEmail } from '@/lib/db/repositories/userRepository';
import { getAppPublicUrl, sendPasswordResetEmail } from '@/lib/email/resend';
import { checkRateLimit } from '@/lib/rate-limit';
import { serverLogger } from '@/lib/serverLogger';

export const runtime = 'nodejs';

const GENERIC_RESPONSE = {
  ok: true,
  message: 'Si el correo existe en CocinaCore, te enviaremos instrucciones para restablecer la contraseña.',
};

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

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
  const body: unknown = await request.json().catch(() => null);
  const parsed = AuthEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ingresá un correo válido.' }, { status: 400 });
  }

  const ip = getIp(request);
  const emailHash = hashPasswordResetIdentity(parsed.data.email);
  const rateLimit = await checkRateLimit('auth/password-reset', ip, emailHash);
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  if (!emailConfigured()) {
    serverLogger.error('auth.password_reset.email_not_configured', {});
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!user) {
    return NextResponse.json(GENERIC_RESPONSE);
  }

  try {
    const token = generatePasswordResetToken();
    await createPasswordResetToken({
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      requestedIpHash: hashPasswordResetIdentity(ip),
      expiresAt: getPasswordResetExpiry(),
    });

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: buildResetUrl(token),
    });
  } catch (error) {
    serverLogger.error('auth.password_reset.request_failed', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(GENERIC_RESPONSE);
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
