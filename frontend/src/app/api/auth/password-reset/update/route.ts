import { type NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth/password';
import { hashPasswordResetToken } from '@/lib/auth/password-reset';
import { ResetPasswordSchema } from '@/lib/auth/schemas';
import { consumePasswordResetToken } from '@/lib/db/repositories/passwordResetRepository';
import { checkRateLimit } from '@/lib/rate-limit';
import { serverLogger } from '@/lib/serverLogger';

export const runtime = 'nodejs';

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ResetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const rateLimit = await checkRateLimit('auth/password-update', getIp(request));
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const consumed = await consumePasswordResetToken(
      hashPasswordResetToken(parsed.data.token),
      async (client, token) => {
        await client.query(
          'update public.users set password_hash = $1, updated_at = now() where id = $2',
          [passwordHash, token.user_id]
        );
        await client.query('delete from public.sessions where user_id = $1', [token.user_id]);
        return true;
      }
    );

    if (!consumed) {
      return NextResponse.json(
        { error: 'El enlace no es válido o expiró. Pedí uno nuevo.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    serverLogger.error('auth.password_reset.update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'No pudimos actualizar la contraseña.' },
      { status: 500 }
    );
  }
}
