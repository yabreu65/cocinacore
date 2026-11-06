import { type NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth/password';
import { hashPasswordResetToken } from '@/lib/auth/password-reset';
import { ResetPasswordSchema } from '@/lib/auth/schemas';
import { consumePasswordResetToken } from '@/lib/db/repositories/passwordResetRepository';
import { checkRateLimit } from '@/lib/rate-limit';
import { serverLogger } from '@/lib/serverLogger';
import { getSafeErrorReason } from '@/lib/safe-error-reason';
import {
  getAuthenticationSecondaryRateLimitKey,
  getRetryAfterSeconds,
  getTargetRateLimitKey,
} from '@/lib/rate-limit-identity';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const body: unknown = await request.json().catch(() => null);
  const parsed = ResetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
      { status: 400 }
    );
  }

  const tokenKey = hashPasswordResetToken(parsed.data.token);
  const targetRateLimitKey = getTargetRateLimitKey(request, tokenKey);
  const targetRateLimit = await checkRateLimit(
    'auth/password-update',
    targetRateLimitKey.identity,
    targetRateLimitKey.userId,
    { requireSharedStore: true }
  );
  const secondaryKey = getAuthenticationSecondaryRateLimitKey(request, 'auth/password-update');
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

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const consumed = await consumePasswordResetToken(tokenKey, async (client, token) => {
      await client.query(
        'update public.users set password_hash = $1, updated_at = now() where id = $2',
        [passwordHash, token.user_id]
      );
      await client.query('delete from public.sessions where user_id = $1', [token.user_id]);
      return true;
    });

    if (!consumed) {
      return NextResponse.json(
        { error: 'El enlace no es válido o expiró. Pedí uno nuevo.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    serverLogger.error('auth.password_reset.update_failed', {
      requestId,
      reason: getSafeErrorReason(error),
    });
    return NextResponse.json({ error: 'No pudimos actualizar la contraseña.' }, { status: 500 });
  }
}
